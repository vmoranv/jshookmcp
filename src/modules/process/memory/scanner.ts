/**
 * Memory Scanner — thin facade re-exporting platform-specific implementations.
 *
 * Platform scan logic lives in:
 *  - scanner.patterns.ts  (shared pattern parsing)
 *  - scanner.windows.ts   (koffi native + PowerShell fallback)
 *  - scanner.linux.ts     (/proc/[pid]/mem direct read)
 *  - scanner.darwin.ts    (lldb + Python scripting)
 */
import { logger } from '@utils/logger';
import type { Platform, MemoryScanResult, PatternType } from '@modules/process/memory/types';
import { scanMemoryWindows } from './scanner.windows';
import { scanMemoryLinux } from './scanner.linux';
import { scanMemoryMac } from './scanner.darwin';

// Re-export pattern helpers for external consumers
export { buildPatternBytesAndMask, patternToBytesMac } from './scanner.patterns';

export async function scanMemory(
  platform: Platform,
  pid: number,
  pattern: string,
  patternType: PatternType = 'hex'
): Promise<MemoryScanResult> {
  try {
    switch (platform) {
      case 'win32':
        return scanMemoryWindows(pid, pattern, patternType);
      case 'linux':
        return scanMemoryLinux(pid, pattern, patternType);
      case 'darwin':
        return scanMemoryMac(pid, pattern, patternType);
      default:
        return { success: false, addresses: [], error: `Memory scan not supported on ${platform}` };
    }
  } catch (error) {
    logger.error('Memory scan failed:', error);
    return {
      success: false,
      addresses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function scanMemoryFiltered(
  pid: number,
  pattern: string,
  addresses: string[],
  patternType: PatternType = 'hex',
  _readMemoryFn: (
    pid: number,
    address: string,
    size: number
  ) => Promise<{ success: boolean; data?: string }>,
  scanMemoryFn: (
    pid: number,
    pattern: string,
    patternType: PatternType
  ) => Promise<MemoryScanResult>
): Promise<MemoryScanResult> {
  const validAddresses: number[] = [];
  for (const addr of addresses) {
    const num = parseInt(addr, 16);
    if (!isNaN(num)) validAddresses.push(num);
  }

  if (validAddresses.length === 0) {
    return { success: false, addresses: [], error: 'No valid addresses provided' };
  }

  const fullScan = await scanMemoryFn(pid, pattern, patternType);
  if (!fullScan.success || fullScan.addresses.length === 0) {
    return {
      success: true,
      addresses: [],
      stats: { resultsFound: 0, patternLength: pattern.length },
    };
  }

  const windowSize = 256;
  const results: string[] = [];

  for (const matchAddr of fullScan.addresses) {
    const matchNum = parseInt(matchAddr, 16);
    if (validAddresses.some((a) => Math.abs(a - matchNum) < windowSize)) {
      if (!results.includes(matchAddr)) {
        results.push(matchAddr);
      }
    }
  }

  return {
    success: true,
    addresses: results,
    stats: { resultsFound: results.length, patternLength: pattern.length },
  };
}
