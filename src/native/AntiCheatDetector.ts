/**
 * Anti-Cheat / Anti-Debug Detection Engine.
 *
 * Scans processes for anti-debug mechanisms, guard pages, and code integrity
 * checks by analyzing imports, memory regions, and section hashes.
 *
 * @module AntiCheatDetector
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { logger } from '@utils/logger';
import {
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
  VirtualQueryEx,
  PAGE,
  EnumProcessModules,
  GetModuleBaseName,
  GetModuleFileNameEx,
  GetModuleInformation,
} from '@native/Win32API';
import { PEAnalyzer } from '@native/PEAnalyzer';
import type {
  AntiCheatDetection,
  AntiCheatMechanism,
  AntiCheatDetectorOptions,
  GuardPageInfo,
  GuardPageScanResult,
  IntegrityCheckInfo,
  IntegrityScanResult,
} from './AntiCheatDetector.types';

// ── Known anti-debug API imports ──

const ANTI_DEBUG_IMPORTS: {
  dll: string;
  funcs: {
    name: string;
    mechanism: AntiCheatMechanism;
    confidence: AntiCheatDetection['confidence'];
    bypass: string;
  }[];
}[] = [
  {
    dll: 'kernel32.dll',
    funcs: [
      {
        name: 'IsDebuggerPresent',
        mechanism: 'anti_debug_api',
        confidence: 'high',
        bypass: 'Hook IsDebuggerPresent to return 0, or patch PEB.BeingDebugged field',
      },
      {
        name: 'CheckRemoteDebuggerPresent',
        mechanism: 'anti_debug_api',
        confidence: 'high',
        bypass: 'Hook CheckRemoteDebuggerPresent to set output to FALSE and return TRUE',
      },
      {
        name: 'OutputDebugStringA',
        mechanism: 'exception_based',
        confidence: 'low',
        bypass: 'May be used for anti-debug timing — monitor for exception handler abuse',
      },
      {
        name: 'GetTickCount',
        mechanism: 'timing_check',
        confidence: 'low',
        bypass: 'Hook GetTickCount to return consistent delta values',
      },
      {
        name: 'GetTickCount64',
        mechanism: 'timing_check',
        confidence: 'low',
        bypass: 'Hook GetTickCount64 to return consistent delta values',
      },
      {
        name: 'QueryPerformanceCounter',
        mechanism: 'timing_check',
        confidence: 'medium',
        bypass: 'Hook QPC to filter out debugging time deltas',
      },
    ],
  },
  {
    dll: 'ntdll.dll',
    funcs: [
      {
        name: 'NtQueryInformationProcess',
        mechanism: 'ntquery_debug',
        confidence: 'high',
        bypass:
          'Hook NtQueryInformationProcess: return 0 for ProcessDebugPort (7), ProcessDebugObjectHandle (30), ProcessDebugFlags (31)',
      },
      {
        name: 'NtSetInformationThread',
        mechanism: 'thread_hiding',
        confidence: 'medium',
        bypass: 'Hook NtSetInformationThread: intercept ThreadHideFromDebugger (0x11) calls',
      },
      {
        name: 'NtClose',
        mechanism: 'exception_based',
        confidence: 'low',
        bypass: 'NtClose with invalid handle detects debugger via exception — hook to suppress',
      },
      {
        name: 'RtlGetNtGlobalFlags',
        mechanism: 'heap_flags',
        confidence: 'medium',
        bypass: 'Clear NtGlobalFlag (FLG_HEAP_*) in PEB at offset 0xBC (x64)',
      },
    ],
  },
];

const DR_CHECK_IMPORTS = ['GetThreadContext', 'SetThreadContext'];

const DEFAULT_LIMITS = {
  guardPageMaxRegions: 20_000,
  guardPageTimeoutMs: 2_000,
  integrityMaxModules: 32,
  integrityMaxSections: 128,
  integrityMaxBytes: 16 * 1024 * 1024,
  integrityMaxSectionBytes: 2 * 1024 * 1024,
  integrityTimeoutMs: 3_000,
} as const;

// ── AntiCheatDetector Class ──

export class AntiCheatDetector {
  private peAnalyzer = new PEAnalyzer();
  private readonly options: Required<AntiCheatDetectorOptions>;

  constructor(options: AntiCheatDetectorOptions = {}) {
    this.options = { ...DEFAULT_LIMITS, ...options };
  }

  /**
   * Scan process for anti-debug / anti-cheat mechanisms by analyzing imports.
   */
  async detect(pid: number): Promise<AntiCheatDetection[]> {
    const detections: AntiCheatDetection[] = [];
    const hProcess = openProcessForMemory(pid);

    try {
      const modules = this._enumerateModules(hProcess);

      for (const mod of modules) {
        try {
          const imports = await this.peAnalyzer.parseImports(pid, mod.base);

          for (const imp of imports) {
            const dllLower = imp.dllName.toLowerCase();

            // Check anti-debug imports
            for (const knownDll of ANTI_DEBUG_IMPORTS) {
              if (dllLower.includes(knownDll.dll.toLowerCase().replace('.dll', ''))) {
                for (const func of knownDll.funcs) {
                  if (imp.functions.some((f) => f.name === func.name)) {
                    detections.push({
                      mechanism: func.mechanism,
                      confidence: func.confidence,
                      location: `import:${func.name}`,
                      moduleName: mod.name,
                      details: `${mod.name} imports ${func.name} from ${imp.dllName}`,
                      bypassSuggestion: func.bypass,
                    });
                  }
                }
              }
            }

            // Check DR register manipulation (hardware breakpoint detection)
            for (const func of imp.functions) {
              if (DR_CHECK_IMPORTS.includes(func.name)) {
                detections.push({
                  mechanism: 'hardware_breakpoint',
                  confidence: 'medium',
                  location: `import:${func.name}`,
                  moduleName: mod.name,
                  details: `${mod.name} imports ${func.name} — may check debug registers for hardware breakpoints`,
                  bypassSuggestion:
                    'Hook GetThreadContext to zero out DR0-DR3 and DR6/DR7 before returning',
                });
              }
            }
          }
        } catch (e) {
          logger.debug(`Import scan skipped for ${mod.name}: ${e}`);
        }
      }
    } finally {
      CloseHandle(hProcess);
    }

    return detections;
  }

  /**
   * Find all guard page regions in the process.
   */
  async findGuardPages(pid: number): Promise<GuardPageInfo[]> {
    return (await this.scanGuardPages(pid)).guardPages;
  }

  async scanGuardPages(pid: number): Promise<GuardPageScanResult> {
    const guardPages: GuardPageInfo[] = [];
    const hProcess = openProcessForMemory(pid);
    const startedAt = Date.now();
    const stats = {
      scannedRegions: 0,
      queryFailures: 0,
      durationMs: 0,
      timedOut: false,
      truncated: false,
      maxRegions: this.options.guardPageMaxRegions,
      timeoutMs: this.options.guardPageTimeoutMs,
    };

    try {
      const modules = this._enumerateModules(hProcess);
      let address = 0n;
      const maxAddress = 0x7fffffffffffn; // User-mode address space

      while (address < maxAddress) {
        if (this._isTimedOut(startedAt, stats.timeoutMs)) {
          stats.timedOut = true;
          stats.truncated = true;
          break;
        }
        if (stats.scannedRegions >= stats.maxRegions) {
          stats.truncated = true;
          break;
        }

        try {
          const result = VirtualQueryEx(hProcess, address);
          if (!result.success) break;
          const mbi = result.info;
          const nextAddress = mbi.BaseAddress + mbi.RegionSize;

          stats.scannedRegions += 1;

          if ((mbi.Protect & PAGE.GUARD) !== 0) {
            // Find which module this belongs to
            let moduleName: string | null = null;
            for (const mod of modules) {
              const modBase = BigInt(mod.base);
              if (mbi.BaseAddress >= modBase && mbi.BaseAddress < modBase + BigInt(mod.size)) {
                moduleName = mod.name;
                break;
              }
            }

            guardPages.push({
              address: `0x${mbi.BaseAddress.toString(16)}`,
              size: Number(mbi.RegionSize),
              moduleName,
              nearbySymbol: null,
            });
          }

          if (mbi.RegionSize <= 0n || nextAddress <= address || nextAddress <= mbi.BaseAddress) {
            stats.truncated = true;
            break;
          }

          address = nextAddress;
        } catch {
          stats.queryFailures += 1;
          address += 0x1000n;
        }
      }
    } finally {
      stats.durationMs = Date.now() - startedAt;
      CloseHandle(hProcess);
    }

    return { guardPages, stats };
  }

  /**
   * Check code section integrity by comparing disk vs memory hashes.
   */
  async checkIntegrity(pid: number, moduleName?: string): Promise<IntegrityCheckInfo[]> {
    return (await this.scanIntegrity(pid, moduleName)).sections;
  }

  async scanIntegrity(pid: number, moduleName?: string): Promise<IntegrityScanResult> {
    const results: IntegrityCheckInfo[] = [];
    const hProcess = openProcessForMemory(pid);
    const startedAt = Date.now();
    const stats = {
      scannedModules: 0,
      scannedSections: 0,
      hashedBytes: 0,
      skippedModules: 0,
      skippedSections: 0,
      durationMs: 0,
      timedOut: false,
      truncated: false,
      maxModules: this.options.integrityMaxModules,
      maxSections: this.options.integrityMaxSections,
      maxBytes: this.options.integrityMaxBytes,
      timeoutMs: this.options.integrityTimeoutMs,
    };
    let stopScan = false;

    try {
      const modules = this._enumerateModules(hProcess);
      const targets = moduleName
        ? modules.filter((m) => m.name.toLowerCase().includes(moduleName.toLowerCase()))
        : modules;

      for (const mod of targets) {
        if (this._shouldStopIntegrityScan(stats, startedAt)) {
          if (this._isTimedOut(startedAt, stats.timeoutMs)) {
            stats.timedOut = true;
          }
          stats.truncated = true;
          break;
        }

        stats.scannedModules += 1;

        try {
          const diskData = await fs.readFile(mod.path);
          const sections = await this.peAnalyzer.listSections(pid, mod.base);

          for (const sec of sections) {
            if (this._shouldStopIntegrityScan(stats, startedAt)) {
              if (this._isTimedOut(startedAt, stats.timeoutMs)) {
                stats.timedOut = true;
              }
              stats.truncated = true;
              stopScan = true;
              break;
            }

            // Only check executable sections
            if (!sec.isExecutable) continue;

            const secRva = parseInt(sec.virtualAddress, 16);
            const secSize = Math.min(sec.virtualSize, sec.rawSize);
            if (secSize <= 0) continue;
            if (secSize > this.options.integrityMaxSectionBytes) {
              stats.skippedSections += 1;
              continue;
            }
            if (stats.hashedBytes + secSize > stats.maxBytes) {
              stats.truncated = true;
              stopScan = true;
              break;
            }

            // Read memory bytes
            const memBytes = ReadProcessMemory(
              hProcess,
              BigInt(mod.base) + BigInt(secRva),
              secSize,
            );

            // Read disk bytes (need RVA → file offset conversion)
            const diskOffset = this._rvaToFileOffset(diskData, secRva);
            if (diskOffset < 0 || diskOffset + secSize > diskData.length) continue;
            const diskBytes = diskData.subarray(diskOffset, diskOffset + secSize);

            const memoryHash = createHash('sha256').update(memBytes).digest('hex');
            const diskHash = createHash('sha256').update(diskBytes).digest('hex');

            results.push({
              sectionName: sec.name,
              moduleName: mod.name,
              diskHash,
              memoryHash,
              isModified: memoryHash !== diskHash,
            });
            stats.scannedSections += 1;
            stats.hashedBytes += secSize;
          }
        } catch (e) {
          stats.skippedModules += 1;
          logger.debug(`Integrity check skipped for ${mod.name}: ${e}`);
        }

        if (stopScan) break;
      }
    } finally {
      stats.durationMs = Date.now() - startedAt;
      CloseHandle(hProcess);
    }

    return { sections: results, stats };
  }

  // ── Private Helpers ──

  private _enumerateModules(
    hProcess: bigint,
  ): { name: string; base: string; path: string; size: number }[] {
    const modules: { name: string; base: string; path: string; size: number }[] = [];

    try {
      const { modules: modHandles, count } = EnumProcessModules(hProcess);
      for (let i = 0; i < count; i++) {
        const hMod = modHandles[i]!;
        const name = GetModuleBaseName(hProcess, hMod);
        const info = GetModuleInformation(hProcess, hMod);
        const modulePath = GetModuleFileNameEx(hProcess, hMod) ?? name;

        if (info.success) {
          modules.push({
            name,
            base: `0x${info.info.lpBaseOfDll.toString(16)}`,
            path: modulePath,
            size: info.info.SizeOfImage,
          });
        }
      }
    } catch (e) {
      logger.debug(`Module enumeration failed: ${e}`);
    }

    return modules;
  }

  private _rvaToFileOffset(peData: Buffer, rva: number): number {
    const e_lfanew = peData.readUInt32LE(60);
    const numSections = peData.readUInt16LE(e_lfanew + 6);
    const sizeOfOptionalHeader = peData.readUInt16LE(e_lfanew + 20);
    const secStart = e_lfanew + 24 + sizeOfOptionalHeader;

    for (let i = 0; i < numSections; i++) {
      const off = secStart + i * 40;
      if (off + 40 > peData.length) break;

      const virtualAddr = peData.readUInt32LE(off + 12);
      const virtualSize = peData.readUInt32LE(off + 8);
      const rawOffset = peData.readUInt32LE(off + 20);

      if (rva >= virtualAddr && rva < virtualAddr + virtualSize) {
        return rawOffset + (rva - virtualAddr);
      }
    }

    return -1;
  }

  private _isTimedOut(startedAt: number, timeoutMs: number): boolean {
    return Date.now() - startedAt >= timeoutMs;
  }

  private _shouldStopIntegrityScan(
    stats: {
      scannedModules: number;
      scannedSections: number;
      hashedBytes: number;
      maxModules: number;
      maxSections: number;
      maxBytes: number;
      timeoutMs: number;
    },
    startedAt: number,
  ): boolean {
    return (
      this._isTimedOut(startedAt, stats.timeoutMs) ||
      stats.scannedModules >= stats.maxModules ||
      stats.scannedSections >= stats.maxSections ||
      stats.hashedBytes >= stats.maxBytes
    );
  }
}

export const antiCheatDetector = new AntiCheatDetector();
