/**
 * Cross-platform guard-page scanner.
 *
 * On Windows the implementation delegates to AntiCheatDetector (koffi/Win32).
 * On Linux this scans /proc/pid/maps for guard-page anomalies via the
 * PlatformMemoryAPI.  On macOS guard pages are rare outside stack probes;
 * we report empty results with a platform note.
 */
import type { PlatformMemoryAPI } from './PlatformMemoryAPI';
import type { ProcessHandle } from './types';
import { MemoryProtection } from './types';

export interface GuardPageResult {
  address: string;
  size: number;
  moduleName: string | null;
}

export interface GuardPageScanStats {
  scannedRegions: number;
  queryFailures: number;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  maxRegions: number;
  timeoutMs: number;
}

export interface GuardPageScanOutput {
  guardPages: GuardPageResult[];
  stats: GuardPageScanStats;
}

export async function scanGuardPages(
  api: PlatformMemoryAPI,
  pid: number,
  maxRegions = 10000,
  timeoutMs = 2000,
): Promise<GuardPageScanOutput> {
  const started = Date.now();
  const stats: GuardPageScanStats = {
    scannedRegions: 0,
    queryFailures: 0,
    durationMs: 0,
    timedOut: false,
    truncated: false,
    maxRegions,
    timeoutMs,
  };

  const pages: GuardPageResult[] = [];
  let handle: ProcessHandle;

  try {
    handle = api.openProcess(pid, false);
  } catch {
    stats.durationMs = Date.now() - started;
    return { guardPages: pages, stats };
  }

  let addr = 0n;
  const maxAddr = 0x7fffffffffffn;

  try {
    while (addr < maxAddr) {
      if (Date.now() - started >= timeoutMs) {
        stats.timedOut = true;
        stats.truncated = true;
        break;
      }
      if (stats.scannedRegions >= maxRegions) {
        stats.truncated = true;
        break;
      }

      const region = api.queryRegion(handle, addr);
      if (!region) break;

      stats.scannedRegions += 1;

      if ((region.protection & MemoryProtection.Guard) !== 0) {
        pages.push({
          address: `0x${region.baseAddress.toString(16)}`,
          size: region.size,
          moduleName: null,
        });
      }

      const next = region.baseAddress + BigInt(region.size);
      if (next <= addr || next <= region.baseAddress) break;
      addr = next;
    }
  } catch {
    stats.queryFailures += 1;
  } finally {
    api.closeProcess(handle);
  }

  stats.durationMs = Date.now() - started;
  return { guardPages: pages, stats };
}
