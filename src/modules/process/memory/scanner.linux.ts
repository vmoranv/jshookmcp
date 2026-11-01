/**
 * Linux memory scanner — reads /proc/[pid]/mem directly.
 */
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { logger } from '@utils/logger';
import { MEMORY_SCAN_MAX_RESULTS, MEMORY_SCAN_REGION_MAX_BYTES } from '@src/constants';
import type { MemoryScanResult } from '@modules/process/memory/types';
import { parseProcMaps } from '@src/modules/process/memory/linux/mapsParser';
import { findPatternInBuffer } from '@native/NativeMemoryManager.utils';
import { buildPatternBytesAndMask } from './scanner.patterns';

function formatLinuxProcAccessError(pid: number, procFile: 'maps' | 'mem', error: unknown): string {
  const err = error as NodeJS.ErrnoException;

  switch (err?.code) {
    case 'ENOENT':
    case 'ESRCH':
      return `Process ${pid} no longer exists or /proc/${pid}/${procFile} is unavailable.`;
    case 'EACCES':
    case 'EPERM':
      return `Cannot access /proc/${pid}/${procFile}. Requires root privileges or ptrace access.`;
    default:
      return err instanceof Error ? err.message : String(error);
  }
}

/** Read `/proc/<pid>/maps` and keep the readable regions, or report why not. */
function readScannableRegions(
  pid: number,
): { regions: Array<{ start: bigint; end: bigint }> } | { error: string } {
  let mapsContent: string;
  try {
    mapsContent = readFileSync(`/proc/${pid}/maps`, 'utf-8');
  } catch (error) {
    return { error: formatLinuxProcAccessError(pid, 'maps', error) };
  }

  const parsedRegions = parseProcMaps(mapsContent);
  const regions = Array.isArray(parsedRegions)
    ? parsedRegions.filter((r) => r.permissions.read)
    : [];
  return { regions };
}

/** Open `/proc/<pid>/mem` for reading, or report why not. */
function openMemoryFile(pid: number): { file: number } | { error: string } {
  try {
    return { file: openSync(`/proc/${pid}/mem`, 'r') };
  } catch (error) {
    return { error: formatLinuxProcAccessError(pid, 'mem', error) };
  }
}

/**
 * Read `region` in `chunkSize` pieces and collect every pattern match.
 *
 * Chunks overlap by `overlap` bytes so a match straddling a chunk boundary is
 * still found. The tail of each non-final chunk is therefore *deferred*: only
 * matches starting before `reportableLimit` are reported now, and the tail is
 * carried into the next chunk where it becomes reachable in full.
 */
function scanRegion(
  fd: number,
  pid: number,
  region: { start: bigint; end: bigint },
  patternBytes: number[],
  mask: number[],
  chunkSize: number,
  maxResults: number,
  foundAddresses: Set<string>,
): void {
  const overlap = Math.max(patternBytes.length - 1, 0);
  let chunkOffset = 0n;
  let carryOver = Buffer.alloc(0);
  const regionSize = region.end - region.start;

  while (chunkOffset < regionSize && foundAddresses.size < maxResults) {
    const remaining = regionSize - chunkOffset;
    const readSize = Number(remaining > BigInt(chunkSize) ? BigInt(chunkSize) : remaining);
    const chunkBuffer = Buffer.allocUnsafe(readSize);

    let bytesRead: number;
    try {
      bytesRead = readSync(fd, chunkBuffer, 0, readSize, region.start + chunkOffset);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (
        err?.code === 'EIO' ||
        err?.code === 'EFAULT' ||
        err?.code === 'EACCES' ||
        err?.code === 'EPERM'
      ) {
        logger.debug('Skipping unreadable Linux memory region chunk', {
          pid,
          start: `0x${region.start.toString(16)}`,
          offset: chunkOffset.toString(),
          code: err.code,
        });
        return;
      }
      throw error;
    }

    if (bytesRead <= 0) {
      break;
    }

    const chunk = bytesRead === readSize ? chunkBuffer : chunkBuffer.subarray(0, bytesRead);
    const scanBuffer = carryOver.length > 0 ? Buffer.concat([carryOver, chunk]) : chunk;
    const scanBase = region.start + chunkOffset - BigInt(carryOver.length);
    const chunkAdvance = BigInt(bytesRead);
    const isLastChunk = chunkOffset + chunkAdvance >= regionSize || bytesRead < readSize;
    const deferredTail = isLastChunk ? 0 : Math.min(overlap, scanBuffer.length);
    const reportableLimit = scanBuffer.length - deferredTail;
    const matches = findPatternInBuffer(scanBuffer, patternBytes, mask);

    for (const matchOffset of matches) {
      if (!isLastChunk && matchOffset >= reportableLimit) {
        continue;
      }

      const absoluteAddress = scanBase + BigInt(matchOffset);
      if (absoluteAddress < region.start || absoluteAddress >= region.end) {
        continue;
      }

      foundAddresses.add(`0x${absoluteAddress.toString(16)}`);
      if (foundAddresses.size >= maxResults) {
        break;
      }
    }

    carryOver =
      deferredTail > 0 ? scanBuffer.subarray(scanBuffer.length - deferredTail) : Buffer.alloc(0);

    chunkOffset += chunkAdvance;

    if (bytesRead < readSize) {
      logger.debug('Linux memory scan stopped after short read', {
        pid,
        start: `0x${region.start.toString(16)}`,
        requested: readSize,
        bytesRead,
      });
      break;
    }
  }
}

export async function scanMemoryLinux(
  pid: number,
  pattern: string,
  patternType: string,
): Promise<MemoryScanResult> {
  let patternBytes: number[];
  let mask: number[];

  try {
    const result = buildPatternBytesAndMask(pattern, patternType);
    patternBytes = result.patternBytes;
    mask = result.mask;
  } catch (error) {
    return {
      success: false,
      addresses: [],
      error: error instanceof Error ? error.message : 'Invalid pattern',
    };
  }

  try {
    const readRegions = readScannableRegions(pid);
    if ('error' in readRegions) {
      return { success: false, addresses: [], error: readRegions.error };
    }

    const fd = openMemoryFile(pid);
    if ('error' in fd) {
      return { success: false, addresses: [], error: fd.error };
    }

    const foundAddresses = new Set<string>();
    // Read/write caps are env-tunable via @src/constants (MEMORY_SCAN_*).
    const chunkSize = MEMORY_SCAN_REGION_MAX_BYTES; // bytes per /proc/pid/mem read
    const maxResults = MEMORY_SCAN_MAX_RESULTS;

    try {
      for (const region of readRegions.regions) {
        if (foundAddresses.size >= maxResults) break;
        if (region.end <= region.start) continue;

        // A skipped region only abandons the rest of THAT region; the outer
        // loop continues with the next one, matching the original `break`
        // out of the inner chunk loop.
        scanRegion(fd.file, pid, region, patternBytes, mask, chunkSize, maxResults, foundAddresses);
      }
    } finally {
      closeSync(fd.file);
    }

    const addresses = Array.from(foundAddresses);

    return {
      success: true,
      addresses,
      stats: { patternLength: patternBytes.length, resultsFound: addresses.length },
    };
  } catch (error) {
    return {
      success: false,
      addresses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
