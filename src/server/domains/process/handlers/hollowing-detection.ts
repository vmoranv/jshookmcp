/**
 * Process Hollowing Detection Handler
 *
 * Detects process hollowing attacks where malware unmaps the original process image
 * and injects malicious code. Compares process memory sections with on-disk binary.
 *
 * Platform strategy:
 *   - Win32:  PEAnalyzer.compareMemoryWithDisk on the main module (PE sections),
 *             with optional autoRestore via WriteProcessMemory.
 *   - Linux/macOS: IntegrityScanner.scanIntegrity — ELF/Mach-O executable-section
 *             SHA-256 hash comparison (reuses the E5-A cross-platform integrity
 *             primitive). autoRestore is Win32-only (cross-platform ptrace/mach
 *             write is too risky to ship without a dedicated audit).
 */

import { argNumber, argBool } from '@server/domains/shared/parse-args';
import {
  PROCESS_HOLLOWING_MAX_DUMP_SECTIONS,
  PROCESS_HOLLOWING_MAX_BYTES_PER_SECTION,
} from '@src/constants';
import { PEAnalyzer } from '@native/PEAnalyzer';
import {
  openProcessForMemory,
  CloseHandle,
  EnumProcessModules,
  GetModuleFileNameEx,
  GetModuleInformation,
  ReadProcessMemory,
} from '@native/Win32API';
import { createPlatformProvider } from '@native/platform/factory';
import { scanIntegrity, type IntegritySectionResult } from '@native/platform/IntegrityScanner';
import type { ProcessManagementHandlers } from './process-management';
import { logger } from '@utils/logger';

export class HollowingDetectionHandlers {
  private peAnalyzer = new PEAnalyzer();
  private processMgmt?: ProcessManagementHandlers;

  constructor(processMgmt?: ProcessManagementHandlers) {
    this.processMgmt = processMgmt;
  }

  async handleDetectHollowing(args: Record<string, unknown>) {
    try {
      const pid = argNumber(args, 'pid');
      if (!pid || pid <= 0) {
        throw new Error('pid must be a positive integer');
      }
      const autoRestore = argBool(args, 'autoRestore', false);
      const includeMemoryDump = argBool(args, 'includeMemoryDump', false);

      const platform = this.processMgmt?.platformValue ?? process.platform;
      if (platform !== 'win32') {
        return this.detectHollowingCrossPlatform(pid, platform);
      }
      return this.detectHollowingWin32(pid, autoRestore, includeMemoryDump);
    } catch (error) {
      return {
        success: false,
        isHollowed: false,
        confidence: 0,
        error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ── Win32 fast path: PE section comparison + optional restore ──

  private async detectHollowingWin32(
    pid: number,
    autoRestore: boolean,
    includeMemoryDump: boolean,
  ) {
    // 1. Open process handle
    const hProcess = openProcessForMemory(pid);

    try {
      // 2. Enumerate process modules
      const modulesResult = EnumProcessModules(hProcess);
      if (!modulesResult.success || modulesResult.modules.length === 0) {
        return {
          success: false,
          isHollowed: false,
          confidence: 0,
          error: 'No modules found in target process (process may have exited)',
        };
      }

      const mainModuleHandle = modulesResult.modules[0]!;
      const moduleBaseHex = `0x${mainModuleHandle.toString(16)}`;

      // 3. Get module file path
      const diskPath = GetModuleFileNameEx(hProcess, mainModuleHandle);
      if (!diskPath) {
        return {
          success: false,
          isHollowed: false,
          confidence: 0,
          error: 'Failed to get module path (process may have exited or access denied)',
          moduleBase: moduleBaseHex,
        };
      }

      // 4. Get module info
      const moduleInfoResult = GetModuleInformation(hProcess, mainModuleHandle);
      if (!moduleInfoResult.success) {
        return {
          success: false,
          isHollowed: false,
          confidence: 0,
          error: 'Failed to get module information',
          moduleBase: moduleBaseHex,
          modulePath: diskPath,
        };
      }

      // 5. Compare memory with disk
      let comparisonResult;
      try {
        comparisonResult = await this.peAnalyzer.compareMemoryWithDisk(
          pid,
          moduleBaseHex,
          diskPath,
        );
      } catch (error) {
        return {
          success: false,
          isHollowed: false,
          confidence: 0,
          error: `Failed to compare memory with disk: ${error instanceof Error ? error.message : String(error)}`,
          moduleBase: moduleBaseHex,
          modulePath: diskPath,
        };
      }

      const isHollowed = !comparisonResult.isMatch;

      // 6. Optional: Auto-restore from disk (HIGH RISK)
      let restored = false;
      let restoreError: string | undefined;

      if (autoRestore && isHollowed) {
        logger.warn(
          `[process_detect_hollowing] autoRestore=true for PID ${pid} - attempting restoration (HIGH RISK)`,
        );
        try {
          restored = await this.restoreFromDisk(
            pid,
            mainModuleHandle,
            diskPath,
            comparisonResult.differences,
          );
        } catch (error) {
          restoreError = `Restoration failed: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(`[process_detect_hollowing] Restoration failed for PID ${pid}:`, error);
        }
      }

      // 7. Build result
      const diffEntries: Array<{
        section: string;
        offset: string;
        size: number;
        memoryHash: string;
        diskHash: string;
        memoryBytes?: string;
        diskBytes?: string;
      }> = comparisonResult.differences.map((d) => ({
        section: d.sectionName,
        offset: `0x${d.offsetStart.toString(16)}`,
        size: d.bytesCompared,
        memoryHash: d.memoryHash.substring(0, 16) + '...', // Truncate for readability
        diskHash: d.diskHash.substring(0, 16) + '...',
      }));

      // 8. Optional: include memory dump for forensic analysis (Win32 only)
      let memoryDump: { included: true; truncated: boolean; totalBytes: number } | undefined;
      if (includeMemoryDump && isHollowed && comparisonResult.differences.length > 0) {
        const maxDumpSections = PROCESS_HOLLOWING_MAX_DUMP_SECTIONS;
        const maxBytesPerSection = PROCESS_HOLLOWING_MAX_BYTES_PER_SECTION;
        let totalBytes = 0;
        let truncated = false;

        try {
          const { promises: fs } = await import('node:fs');
          const diskBuffer = await fs.readFile(diskPath);
          const diskPE = this.peAnalyzer.parsePEFromBuffer(diskBuffer);

          const diffsToDump = comparisonResult.differences.slice(0, maxDumpSections);
          if (comparisonResult.differences.length > maxDumpSections) {
            truncated = true;
          }

          for (let i = 0; i < diffsToDump.length; i++) {
            const diff = diffsToDump[i]!;
            const entry = diffEntries[i]!;
            const readSize = Math.min(maxBytesPerSection, diff.bytesCompared);
            if (diff.bytesCompared > maxBytesPerSection) {
              truncated = true;
            }

            // Read memory bytes from the live process
            const memoryBuffer = ReadProcessMemory(
              hProcess,
              mainModuleHandle + BigInt(diff.offsetStart),
              readSize,
            );
            entry.memoryBytes = memoryBuffer.subarray(0, readSize).toString('hex');

            // Read disk bytes from the on-disk PE file
            const diskSection = diskPE.sections.find((s) => s.name === diff.sectionName);
            if (diskSection) {
              const diskEnd = diskSection.pointerToRawData + readSize;
              const diskSlice = diskBuffer.subarray(diskSection.pointerToRawData, diskEnd);
              entry.diskBytes = diskSlice.subarray(0, readSize).toString('hex');
            } else {
              entry.diskBytes = '';
            }

            totalBytes += readSize;
          }

          memoryDump = { included: true, truncated, totalBytes };
        } catch (error) {
          logger.warn(
            `[process_detect_hollowing] Memory dump collection failed for PID ${pid}:`,
            error,
          );
          memoryDump = { included: true, truncated: false, totalBytes: 0 };
        }
      }

      return {
        success: true,
        isHollowed,
        confidence: comparisonResult.confidence,
        modulePath: diskPath,
        moduleBase: moduleBaseHex,
        moduleSizeOfImage: moduleInfoResult.info.SizeOfImage,
        differences: diffEntries,
        memoryDump,
        restored,
        restoreError,
        warning: autoRestore
          ? 'HIGH RISK: Memory restoration attempted. Target process may crash or behave unexpectedly.'
          : isHollowed
            ? 'Process appears to be hollowed. Use autoRestore=true to attempt restoration (HIGH RISK).'
            : undefined,
      };
    } finally {
      CloseHandle(hProcess);
    }
  }

  // ── Linux/macOS fallback: IntegrityScanner section hash comparison ──

  private async detectHollowingCrossPlatform(pid: number, platform: string) {
    let api;
    try {
      api = createPlatformProvider();
    } catch (error) {
      return {
        success: false,
        isHollowed: false,
        confidence: 0,
        error: `Cross-platform memory provider unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let scan;
    try {
      scan = await scanIntegrity(api, pid);
    } catch (error) {
      return {
        success: false,
        isHollowed: false,
        confidence: 0,
        error: `Integrity scan failed: ${error instanceof Error ? error.message : String(error)}`,
        platformNote: `Cross-platform fallback (${platform}): ELF/Mach-O section hash comparison via IntegrityScanner.`,
      };
    }

    // A hollowed process has its main executable's code sections overwritten.
    // IntegrityScanner hashes every executable section of every module and flags
    // those whose in-memory SHA-256 differs from the on-disk slice. Any modified
    // executable section is hollowing evidence.
    const modified = scan.sections.filter((s) => s.isModified);
    const isHollowed = modified.length > 0;
    const confidence = isHollowed ? Math.min(95, 80 + modified.length * 5) : 95;

    const differences = modified.map((s: IntegritySectionResult) => ({
      section: s.sectionName,
      moduleName: s.moduleName,
      memoryHash: s.memoryHash.substring(0, 16) + '...',
      diskHash: s.diskHash.substring(0, 16) + '...',
    }));

    return {
      success: true,
      isHollowed,
      confidence,
      platform: platform,
      differences,
      scannedSections: scan.stats.scannedSections,
      skippedSections: scan.stats.skippedSections,
      timedOut: scan.stats.timedOut,
      truncated: scan.stats.truncated,
      restored: false,
      platformNote:
        `Cross-platform fallback (${platform}): ELF/Mach-O executable-section SHA-256 ` +
        `comparison via IntegrityScanner. autoRestore is Win32-only.`,
      warning: isHollowed
        ? `${modified.length} executable section(s) differ from disk — consistent with process hollowing (or runtime patching / packing). Inspect differences[].moduleName to identify the affected module.`
        : undefined,
    };
  }

  /**
   * Restore original code from disk to process memory.
   * WARNING: This is a HIGH RISK operation that modifies the target process.
   */
  private async restoreFromDisk(
    pid: number,
    moduleBase: bigint,
    diskPath: string,
    differences: Array<{ sectionName: string; offsetStart: number; bytesCompared: number }>,
  ): Promise<boolean> {
    // Import MemoryController and Win32API functions (used in restoration scope only)
    const { promises: fs } = await import('node:fs');
    const win32 = await import('@native/Win32API');

    const hProcess = win32.openProcessForMemory(pid, true);

    try {
      // Read disk PE file
      const diskBuffer = await fs.readFile(diskPath);
      const diskPE = this.peAnalyzer.parsePEFromBuffer(diskBuffer);

      // Restore each differing section
      for (const diff of differences) {
        const diskSection = diskPE.sections.find((s) => s.name === diff.sectionName);
        if (!diskSection) {
          logger.warn(
            `[restoreFromDisk] Section ${diff.sectionName} not found in disk PE, skipping`,
          );
          continue;
        }

        // Read original bytes from disk
        const originalBytes = diskBuffer.subarray(
          diskSection.pointerToRawData,
          diskSection.pointerToRawData + Math.min(diskSection.sizeOfRawData, diff.bytesCompared),
        );

        const targetAddr = moduleBase + BigInt(diff.offsetStart);

        // Change protection to writable
        const { oldProtect } = win32.VirtualProtectEx(
          hProcess,
          targetAddr,
          originalBytes.length,
          win32.PAGE.READWRITE,
        );

        // Write original bytes back
        win32.WriteProcessMemory(hProcess, targetAddr, originalBytes);

        // Restore original protection
        win32.VirtualProtectEx(hProcess, targetAddr, originalBytes.length, oldProtect);

        logger.info(
          `[restoreFromDisk] Restored section ${diff.sectionName} (${originalBytes.length} bytes) at 0x${targetAddr.toString(16)}`,
        );
      }

      return true;
    } catch (error) {
      logger.error('[restoreFromDisk] Restoration failed:', error);
      throw error;
    } finally {
      win32.CloseHandle(hProcess);
    }
  }
}
