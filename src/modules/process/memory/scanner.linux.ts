/**
 * Linux memory scanner — reads /proc/[pid]/mem directly.
 */
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { logger } from '@utils/logger';
import type { MemoryScanResult } from '@modules/process/memory/types';
import { parseProcMaps } from './linux/mapsParser';
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

export async function scanMemoryLinux(
  pid: number,
  pattern: string,
  patternType: string
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
    let mapsContent: string;
    try {
      mapsContent = readFileSync(`/proc/${pid}/maps`, 'utf-8');
    } catch (error) {
      return {
        success: false,
        addresses: [],
        error: formatLinuxProcAccessError(pid, 'maps', error),
      };
    }

    const linuxRegions = parseProcMaps(mapsContent).filter((r) => r.permissions.read);

    let fd: number;
    try {
      fd = openSync(`/proc/${pid}/mem`, 'r');
    } catch (error) {
      return {
        success: false,
        addresses: [],
        error: formatLinuxProcAccessError(pid, 'mem', error),
      };
    }

    const foundAddresses = new Set<string>();
    const chunkSize = 16 * 1024 * 1024;
    const maxResults = 10000;
    const overlap = Math.max(patternBytes.length - 1, 0);

    try {
      for (const region of linuxRegions) {
        if (foundAddresses.size >= maxResults) break;
        if (region.end <= region.start) continue;

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
              break;
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

          if (deferredTail > 0) {
            carryOver = scanBuffer.subarray(scanBuffer.length - deferredTail);
          } else {
            carryOver = Buffer.alloc(0);
          }

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
    } finally {
      closeSync(fd);
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
