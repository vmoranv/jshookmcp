import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PlatformMemoryAPI } from './PlatformMemoryAPI';
import type { ProcessHandle } from './types';
import { parseElfSections } from './ElfParser';
import { parseMachoSections } from './MachOParser';

export interface IntegritySectionResult {
  sectionName: string;
  moduleName: string;
  diskHash: string;
  memoryHash: string;
  isModified: boolean;
}

export interface IntegrityScanStats {
  scannedModules: number;
  scannedSections: number;
  hashedBytes: number;
  skippedModules: number;
  skippedSections: number;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  maxModules: number;
  maxSections: number;
  maxBytes: number;
  timeoutMs: number;
}

export interface IntegrityScanOutput {
  sections: IntegritySectionResult[];
  stats: IntegrityScanStats;
}

const MAX_MODULES = 32;
const MAX_SECTIONS = 128;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_SECTION_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 3000;

export async function scanIntegrity(
  api: PlatformMemoryAPI,
  pid: number,
  moduleName?: string,
): Promise<IntegrityScanOutput> {
  const started = Date.now();
  const stats: IntegrityScanStats = {
    scannedModules: 0,
    scannedSections: 0,
    hashedBytes: 0,
    skippedModules: 0,
    skippedSections: 0,
    durationMs: 0,
    timedOut: false,
    truncated: false,
    maxModules: MAX_MODULES,
    maxSections: MAX_SECTIONS,
    maxBytes: MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
  };
  const sections: IntegritySectionResult[] = [];

  let handle: ProcessHandle;
  try {
    handle = api.openProcess(pid, false);
  } catch {
    stats.durationMs = Date.now() - started;
    return { sections, stats };
  }

  try {
    const modules = api.enumerateModules(handle);
    const targets = moduleName
      ? modules.filter((m: { name: string }) =>
          m.name.toLowerCase().includes(moduleName.toLowerCase()),
        )
      : modules;

    for (const mod of targets) {
      if (Date.now() - started >= TIMEOUT_MS) {
        stats.timedOut = true;
        stats.truncated = true;
        break;
      }
      if (stats.scannedModules >= MAX_MODULES) {
        stats.truncated = true;
        break;
      }
      stats.scannedModules += 1;

      const diskSections =
        api.platform === 'linux'
          ? parseElfSections(mod.name)
          : api.platform === 'darwin'
            ? parseMachoSections(mod.name)
            : [];

      for (const sec of diskSections) {
        if (stats.scannedSections >= MAX_SECTIONS) {
          stats.truncated = true;
          break;
        }
        if (stats.hashedBytes + sec.size > MAX_BYTES) {
          stats.truncated = true;
          break;
        }
        if (!sec.isExecutable) continue;
        if (sec.size <= 0 || sec.size > MAX_SECTION_BYTES) {
          stats.skippedSections += 1;
          continue;
        }

        try {
          const memResult = api.readMemory(handle, mod.baseAddress + sec.addr, sec.size);
          const diskData = readFileSync(mod.name);
          const diskSlice = diskData.subarray(sec.fileOffset, sec.fileOffset + sec.size);

          const memHash = createHash('sha256').update(memResult.data).digest('hex');
          const diskHash = createHash('sha256').update(diskSlice).digest('hex');

          sections.push({
            sectionName: sec.name,
            moduleName: mod.name.split('/').pop() ?? mod.name,
            diskHash,
            memoryHash: memHash,
            isModified: memHash !== diskHash,
          });
          stats.scannedSections += 1;
          stats.hashedBytes += sec.size;
        } catch {
          stats.skippedSections += 1;
        }
      }
    }
  } finally {
    api.closeProcess(handle);
  }

  stats.durationMs = Date.now() - started;
  return { sections, stats };
}
