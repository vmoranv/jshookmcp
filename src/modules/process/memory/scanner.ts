/**
 * Memory Scanner - platform-specific scan implementations
 */

import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { logger } from '@utils/logger';
import {
  execAsync,
  executePowerShellScript,
  type Platform,
  type MemoryScanResult,
  type PatternType,
} from '@modules/process/memory/types';
import { nativeMemoryManager } from '../../../native/NativeMemoryManager';
import { isKoffiAvailable } from '../../../native/NativeMemoryManager.utils';
import { parseProcMaps } from './linux/mapsParser';
import { findPatternInBuffer } from '@native/NativeMemoryManager.utils';

// ---------------------------------------------------------------------------
// Pattern helpers (shared between Windows and macOS implementations)
// ---------------------------------------------------------------------------

export function buildPatternBytesAndMask(
  pattern: string,
  patternType: string
): { patternBytes: number[]; mask: number[] } {
  let patternBytes: number[] = [];
  let mask: number[] = [];

  switch (patternType) {
    case 'hex': {
      const hexParts = pattern.trim().split(/\s+/);
      for (const part of hexParts) {
        if (part === '??' || part === '**' || part === '?') {
          patternBytes.push(0);
          mask.push(0);
        } else {
          const byte = parseInt(part, 16);
          if (!isNaN(byte)) {
            patternBytes.push(byte);
            mask.push(1);
          }
        }
      }
      break;
    }
    case 'int32': {
      const int32Val = parseInt(pattern);
      if (!isNaN(int32Val)) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeInt32LE(int32Val, 0);
        patternBytes = Array.from(buf);
        mask = [1, 1, 1, 1];
      }
      break;
    }
    case 'int64': {
      const int64Val = BigInt.asIntN(64, BigInt(pattern));
      const buf64 = Buffer.allocUnsafe(8);
      buf64.writeBigInt64LE(int64Val, 0);
      patternBytes = Array.from(buf64);
      mask = [1, 1, 1, 1, 1, 1, 1, 1];
      break;
    }
    case 'float': {
      const floatVal = parseFloat(pattern);
      if (!isNaN(floatVal)) {
        const bufFloat = Buffer.allocUnsafe(4);
        bufFloat.writeFloatLE(floatVal, 0);
        patternBytes = Array.from(bufFloat);
        mask = [1, 1, 1, 1];
      }
      break;
    }
    case 'double': {
      const doubleVal = parseFloat(pattern);
      if (!isNaN(doubleVal)) {
        const bufDouble = Buffer.allocUnsafe(8);
        bufDouble.writeDoubleLE(doubleVal, 0);
        patternBytes = Array.from(bufDouble);
        mask = [1, 1, 1, 1, 1, 1, 1, 1];
      }
      break;
    }
    case 'string': {
      const stringBuf = Buffer.from(pattern, 'utf8');
      patternBytes = Array.from(stringBuf);
      mask = patternBytes.map(() => 1);
      break;
    }
  }

  if (patternBytes.length === 0) {
    throw new Error('Invalid pattern');
  }

  return { patternBytes, mask };
}

/** Convert a pattern string to a byte array and mask for macOS with wildcard support. */
export function patternToBytesMac(pattern: string, patternType: string): { bytes: number[]; mask: number[] } {
  const bytes: number[] = [];
  const mask: number[] = [];

  switch (patternType) {
    case 'hex': {
      const parts = pattern.trim().split(/\s+/);
      for (const part of parts) {
        if (part === '??' || part === '?' || part === '**') {
          bytes.push(0);
          mask.push(0);
        } else {
          const b = parseInt(part, 16);
          if (isNaN(b)) throw new Error(`Invalid hex byte: ${part}`);
          bytes.push(b);
          mask.push(1);
        }
      }
      if (!bytes.length) throw new Error('Pattern is empty');
      break;
    }
    case 'int32': {
      const v = parseInt(pattern);
      if (isNaN(v)) throw new Error('Invalid int32 value');
      const buf = Buffer.allocUnsafe(4);
      buf.writeInt32LE(v, 0);
      const arr = Array.from(buf);
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    case 'int64': {
      const buf = Buffer.allocUnsafe(8);
      buf.writeBigInt64LE(BigInt.asIntN(64, BigInt(pattern)), 0);
      const arr = Array.from(buf);
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    case 'float': {
      const v = parseFloat(pattern);
      if (isNaN(v)) throw new Error('Invalid float value');
      const buf = Buffer.allocUnsafe(4);
      buf.writeFloatLE(v, 0);
      const arr = Array.from(buf);
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    case 'double': {
      const v = parseFloat(pattern);
      if (isNaN(v)) throw new Error('Invalid double value');
      const buf = Buffer.allocUnsafe(8);
      buf.writeDoubleLE(v, 0);
      const arr = Array.from(buf);
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    case 'string': {
      const arr = Array.from(Buffer.from(pattern, 'utf8'));
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    default:
      throw new Error(`Unsupported pattern type: ${patternType}`);
  }

  return { bytes, mask };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function buildMemoryScanScript(pid: number, pattern: string, patternType: string): string {
  const { patternBytes, mask } = buildPatternBytesAndMask(pattern, patternType);
  const patternArray = patternBytes.join(',');
  const maskArray = mask.join(',');

  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.ComponentModel;

public class MemoryScanner {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int read);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern int VirtualQueryEx(IntPtr hProcess, IntPtr addr, out MEMORY_BASIC_INFORMATION info, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_VM_READ = 0x0010;
    const int PROCESS_QUERY_INFORMATION = 0x0400;

    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORY_BASIC_INFORMATION {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    const uint MEM_COMMIT = 0x1000;
    const uint PAGE_READONLY = 0x02;
    const uint PAGE_READWRITE = 0x04;
    const uint PAGE_WRITECOPY = 0x08;
    const uint PAGE_EXECUTE_READ = 0x20;
    const uint PAGE_EXECUTE_READWRITE = 0x40;

    public static List<string> ScanMemory(int pid, byte[] pattern, byte[] mask, int maxResults = 10000) {
        var results = new List<string>();
        IntPtr hProcess = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            IntPtr addr = IntPtr.Zero;
            MEMORY_BASIC_INFORMATION info;
            int infoSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
            int scannedRegions = 0;

            while (VirtualQueryEx(hProcess, addr, out info, infoSize) == infoSize) {
                scannedRegions++;
                bool isReadable = (info.State == MEM_COMMIT) &&
                    ((info.Protect & PAGE_READONLY) != 0 ||
                     (info.Protect & PAGE_READWRITE) != 0 ||
                     (info.Protect & PAGE_WRITECOPY) != 0 ||
                     (info.Protect & PAGE_EXECUTE_READ) != 0 ||
                     (info.Protect & PAGE_EXECUTE_READWRITE) != 0);

                if (isReadable && info.RegionSize.ToInt64() > 0 && info.RegionSize.ToInt64() < 1073741824) {
                    long regionSize = info.RegionSize.ToInt64();
                    if (regionSize > 16777216) regionSize = 16777216; // bound scan window per region (16MB)
                    byte[] buffer = new byte[(int)regionSize];
                    int bytesRead;

                    if (ReadProcessMemory(hProcess, info.BaseAddress, buffer, buffer.Length, out bytesRead)) {
                        for (int i = 0; i <= bytesRead - pattern.Length; i++) {
                            if (PatternMatch(buffer, i, pattern, mask)) {
                                long foundAddr = info.BaseAddress.ToInt64() + i;
                                results.Add("0x" + foundAddr.ToString("X"));
                                if (results.Count >= maxResults) break;
                            }
                        }
                    }
                }

                if (results.Count >= maxResults) break;
                if (scannedRegions >= 50000) break;
                long baseAddr = info.BaseAddress.ToInt64();
                long regionSizeRaw = info.RegionSize.ToInt64();
                if (regionSizeRaw <= 0) break;
                long nextAddr = baseAddr + regionSizeRaw;
                if (nextAddr <= baseAddr) break;
                addr = new IntPtr(nextAddr);
                if (addr.ToInt64() >= 0x7FFFFFFF0000) break;
            }

            return results;
        } finally {
            CloseHandle(hProcess);
        }
    }

    private static bool PatternMatch(byte[] buffer, int offset, byte[] pattern, byte[] mask) {
        for (int i = 0; i < pattern.Length; i++) {
            if (mask[i] == 1 && buffer[offset + i] != pattern[i]) {
                return false;
            }
        }
        return true;
    }
}
"@

try {
    $patternBytes = @(${patternArray})
    $maskBytes = @(${maskArray})
    $results = [MemoryScanner]::ScanMemory(${pid}, $patternBytes, $maskBytes, 1000)
    @{
        success = $true;
        addresses = $results;
        stats = @{
            patternLength = $patternBytes.Length;
            resultsFound = $results.Count
        }
    } | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
  `.trim();
}

async function scanMemoryWindows(
  pid: number,
  pattern: string,
  patternType: string
): Promise<MemoryScanResult> {
  try {
    if (isKoffiAvailable()) {
      try {
        const nativeResult = await nativeMemoryManager.scanMemory(pid, pattern, patternType as PatternType);
        if (nativeResult.success) {
          return nativeResult;
        }

        logger.warn('Native Windows memory scan failed, falling back to PowerShell', {
          pid,
          patternType,
          error: nativeResult.error,
          nativeAvailable: isKoffiAvailable(),
        });
      } catch (error) {
        logger.warn('Native Windows memory scan threw, falling back to PowerShell', {
          pid,
          patternType,
          error: error instanceof Error ? error.message : String(error),
          nativeAvailable: isKoffiAvailable(),
        });
      }
    }

    const psScript = buildMemoryScanScript(pid, pattern, patternType);

    const { stdout, stderr } = await executePowerShellScript(psScript, {
      maxBuffer: 1024 * 1024 * 50,
      timeout: 120000,
    });

    if (stderr && stderr.includes('Error')) {
      return { success: false, addresses: [], error: stderr };
    }

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return {
      success: result.success,
      addresses: result.addresses || [],
      error: result.error,
      stats: result.stats,
    };
  } catch (error) {
    logger.error('Windows memory scan failed:', error);
    return {
      success: false,
      addresses: [],
      error: error instanceof Error ? error.message : 'PowerShell execution failed. Run as Administrator.',
    };
  }
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

function formatLinuxProcAccessError(
  pid: number,
  procFile: 'maps' | 'mem',
  error: unknown
): string {
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

async function scanMemoryLinux(
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

    const linuxRegions = parseProcMaps(mapsContent).filter(r => r.permissions.read);

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
            if (err?.code === 'EIO' || err?.code === 'EFAULT' || err?.code === 'EACCES' || err?.code === 'EPERM') {
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

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

async function scanMemoryMac(pid: number, pattern: string, patternType: string): Promise<MemoryScanResult> {
  let patternBytes: number[];
  let patternMask: number[];
  try {
    const result = patternToBytesMac(pattern, patternType);
    patternBytes = result.bytes;
    patternMask = result.mask;
  } catch (e) {
    return { success: false, addresses: [], error: e instanceof Error ? e.message : 'Invalid pattern' };
  }

  const byteList = patternBytes.map(b => `0x${b.toString(16)}`).join(',');
  const maskList = patternMask.join(',');
  const tag = `${pid}_${Date.now()}`;
  const pyFile = `/tmp/lldb_scan_${tag}.py`;
  const cmdFile = `/tmp/lldb_scan_${tag}.txt`;

  const pyScript = `
import lldb, json, sys

def __lldb_init_module(debugger, internal_dict):
    proc = debugger.GetSelectedTarget().GetProcess()
    pat = bytes([${byteList}])
    mask = [${maskList}]
    results = []
    rl = proc.GetMemoryRegions()
    for i in range(rl.GetSize()):
        info = lldb.SBMemoryRegionInfo()
        rl.GetMemoryRegionAtIndex(i, info)
        if not info.IsReadable():
            continue
        s = info.GetRegionBase()
        sz = info.GetRegionEnd() - s
        if sz > 32 * 1024 * 1024:
            continue
        err = lldb.SBError()
        data = proc.ReadMemory(s, sz, err)
        if not err.Success():
            continue
        n = len(pat)
        for j in range(len(data) - n + 1):
            match = True
            for k in range(n):
                if mask[k] == 1 and data[j+k] != pat[k]:
                    match = False
                    break
            if match:
                results.append(hex(s + j))
                if len(results) >= 1000:
                    break
        if len(results) >= 1000:
            break
    sys.stdout.write('SCAN_RESULT:' + json.dumps({
        'success': True,
        'addresses': results,
        'stats': {'patternLength': len(pat), 'resultsFound': len(results)}
    }) + '\\n')
    sys.stdout.flush()
`;

  await fs.writeFile(pyFile, pyScript, 'utf8');
  await fs.writeFile(cmdFile, `command script import ${pyFile}\nprocess detach\n`, 'utf8');
  try {
    const { stdout } = await execAsync(`lldb --batch -p ${pid} --source ${cmdFile}`, {
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 5,
    });
    const line = stdout.split('\n').find(l => l.startsWith('SCAN_RESULT:'));
    if (!line) {
      const errLine = stdout.split('\n').find(l => l.includes('error:')) ?? '';
      return {
        success: false,
        addresses: [],
        error: `lldb scan returned no result. ${errLine}`.trim(),
      };
    }
    return JSON.parse(line.slice('SCAN_RESULT:'.length)) as MemoryScanResult;
  } catch (error) {
    return { success: false, addresses: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.unlink(pyFile).catch(() => {});
    await fs.unlink(cmdFile).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public dispatchers
// ---------------------------------------------------------------------------

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
    return { success: false, addresses: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function scanMemoryFiltered(
  pid: number,
  pattern: string,
  addresses: string[],
  patternType: PatternType = 'hex',
  _readMemoryFn: (pid: number, address: string, size: number) => Promise<{ success: boolean; data?: string }>,
  scanMemoryFn: (pid: number, pattern: string, patternType: PatternType) => Promise<MemoryScanResult>
): Promise<MemoryScanResult> {
  const validAddresses: number[] = [];
  for (const addr of addresses) {
    const num = parseInt(addr, 16);
    if (!isNaN(num)) validAddresses.push(num);
  }

  if (validAddresses.length === 0) {
    return { success: false, addresses: [], error: 'No valid addresses provided' };
  }

  // Perform a single full scan instead of one per address
  const fullScan = await scanMemoryFn(pid, pattern, patternType);
  if (!fullScan.success || fullScan.addresses.length === 0) {
    return { success: true, addresses: [], stats: { resultsFound: 0, patternLength: pattern.length } };
  }

  // Filter results to those near the provided addresses
  const windowSize = 256;
  const results: string[] = [];

  for (const matchAddr of fullScan.addresses) {
    const matchNum = parseInt(matchAddr, 16);
    if (validAddresses.some(a => Math.abs(a - matchNum) < windowSize)) {
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
