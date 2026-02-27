/**
 * Memory Scanner - platform-specific scan implementations
 */

import { promises as fs } from 'node:fs';
import { logger } from '../../../utils/logger.js';
import {
  execAsync,
  executePowerShellScript,
  type Platform,
  type MemoryScanResult,
  type PatternType,
} from './types.js';

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

/** Convert a pattern string to a plain byte array for macOS (no wildcard support). */
export function patternToBytesMac(pattern: string, patternType: string): number[] {
  switch (patternType) {
    case 'hex': {
      const bytes: number[] = [];
      for (const part of pattern.trim().split(/\s+/)) {
        if (part === '??' || part === '?' || part === '**') continue;
        const b = parseInt(part, 16);
        if (isNaN(b)) throw new Error(`Invalid hex byte: ${part}`);
        bytes.push(b);
      }
      if (!bytes.length) throw new Error('Pattern is empty or all wildcards');
      return bytes;
    }
    case 'int32': {
      const v = parseInt(pattern);
      if (isNaN(v)) throw new Error('Invalid int32 value');
      const buf = Buffer.allocUnsafe(4);
      buf.writeInt32LE(v, 0);
      return Array.from(buf);
    }
    case 'int64': {
      const buf = Buffer.allocUnsafe(8);
      buf.writeBigInt64LE(BigInt.asIntN(64, BigInt(pattern)), 0);
      return Array.from(buf);
    }
    case 'float': {
      const v = parseFloat(pattern);
      if (isNaN(v)) throw new Error('Invalid float value');
      const buf = Buffer.allocUnsafe(4);
      buf.writeFloatLE(v, 0);
      return Array.from(buf);
    }
    case 'double': {
      const v = parseFloat(pattern);
      if (isNaN(v)) throw new Error('Invalid double value');
      const buf = Buffer.allocUnsafe(8);
      buf.writeDoubleLE(v, 0);
      return Array.from(buf);
    }
    case 'string':
      return Array.from(Buffer.from(pattern, 'utf8'));
    default:
      throw new Error(`Unsupported pattern type: ${patternType}`);
  }
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

async function scanMemoryLinux(
  _pid: number,
  _pattern: string,
  _patternType: string
): Promise<MemoryScanResult> {
  return {
    success: false,
    addresses: [],
    error:
      'Memory scanning on Linux requires scanning /proc/pid/maps and iterating regions. Use scanmem or GameConqueror for now.',
  };
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

async function scanMemoryMac(pid: number, pattern: string, patternType: string): Promise<MemoryScanResult> {
  let patternBytes: number[];
  try {
    patternBytes = patternToBytesMac(pattern, patternType);
  } catch (e) {
    return { success: false, addresses: [], error: e instanceof Error ? e.message : 'Invalid pattern' };
  }

  const byteList = patternBytes.map(b => `0x${b.toString(16)}`).join(',');
  const tag = `${pid}_${Date.now()}`;
  const pyFile = `/tmp/lldb_scan_${tag}.py`;
  const cmdFile = `/tmp/lldb_scan_${tag}.txt`;

  const pyScript = `
import lldb, json, sys

def __lldb_init_module(debugger, internal_dict):
    proc = debugger.GetSelectedTarget().GetProcess()
    pat = bytes([${byteList}])
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
            if data[j:j+n] == pat:
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
  readMemoryFn: (pid: number, address: string, size: number) => Promise<{ success: boolean; data?: string }>,
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

  const results: string[] = [];
  const windowSize = 256;

  for (const addr of validAddresses) {
    const readResult = await readMemoryFn(pid, `0x${addr.toString(16)}`, windowSize);
    if (readResult.success && readResult.data) {
      const matchResult = await scanMemoryFn(pid, pattern, patternType);
      if (matchResult.success) {
        for (const matchAddr of matchResult.addresses) {
          const matchNum = parseInt(matchAddr, 16);
          if (validAddresses.some(a => Math.abs(a - matchNum) < windowSize)) {
            if (!results.includes(matchAddr)) {
              results.push(matchAddr);
            }
          }
        }
      }
    }
  }

  return {
    success: true,
    addresses: results,
    stats: { resultsFound: results.length, patternLength: pattern.length },
  };
}
