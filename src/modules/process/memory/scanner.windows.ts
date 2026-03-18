/**
 * Windows memory scanner — koffi native + PowerShell fallback.
 */
import { logger } from '@utils/logger';
import { executePowerShellScript, type MemoryScanResult } from '@modules/process/memory/types';
import { nativeMemoryManager } from '../../../native/NativeMemoryManager';
import { isKoffiAvailable } from '../../../native/NativeMemoryManager.utils';
import type { PatternType } from '@modules/process/memory/types';
import { buildPatternBytesAndMask } from './scanner.patterns';

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

export async function scanMemoryWindows(
  pid: number,
  pattern: string,
  patternType: string
): Promise<MemoryScanResult> {
  try {
    if (isKoffiAvailable()) {
      try {
        const nativeResult = await nativeMemoryManager.scanMemory(
          pid,
          pattern,
          patternType as PatternType
        );
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
      error:
        error instanceof Error
          ? error.message
          : 'PowerShell execution failed. Run as Administrator.',
    };
  }
}
