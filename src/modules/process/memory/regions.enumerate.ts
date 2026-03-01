import { logger } from '../../../utils/logger.js';
import { execAsync, executePowerShellScript, type MemoryRegion, type Platform } from './types.js';

interface DarwinMemoryRegion {
  baseAddress: string;
  size: number;
  type: string;
  protect: string;
  maxProtect: string;
  isReadable: boolean;
  isWritable: boolean;
  isExecutable: boolean;
}

export type EnumeratedRegion = MemoryRegion | DarwinMemoryRegion;

function buildEnumerateRegionsScript(pid: number): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.ComponentModel;

public class RegionEnumerator {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern int VirtualQueryEx(IntPtr hProcess, IntPtr addr, out MEMORY_BASIC_INFORMATION info, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

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
    const uint MEM_FREE = 0x10000;
    const uint MEM_RESERVE = 0x2000;
    const uint PAGE_READONLY = 0x02;
    const uint PAGE_READWRITE = 0x04;
    const uint PAGE_WRITECOPY = 0x08;
    const uint PAGE_EXECUTE = 0x10;
    const uint PAGE_EXECUTE_READ = 0x20;
    const uint PAGE_EXECUTE_READWRITE = 0x40;

    public static List<object> EnumerateRegions(int pid) {
        var regions = new List<object>();
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid);
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
                string state = info.State == MEM_COMMIT ? "COMMIT" : (info.State == MEM_RESERVE ? "RESERVE" : (info.State == MEM_FREE ? "FREE" : "UNKNOWN"));
                string protect = GetProtectionString(info.Protect);
                bool isReadable = (info.State == MEM_COMMIT) && ((info.Protect & (PAGE_READONLY | PAGE_READWRITE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE)) != 0);

                regions.Add(new {
                    baseAddress = "0x" + info.BaseAddress.ToInt64().ToString("X"),
                    size = info.RegionSize.ToInt64(),
                    state = state,
                    protection = protect,
                    isReadable = isReadable,
                    type = info.Type == 0x1000000 ? "IMAGE" : (info.Type == 0x40000 ? "MAPPED" : "PRIVATE")
                });

                if (regions.Count >= 10000 || scannedRegions >= 50000) break;
                long baseAddr = info.BaseAddress.ToInt64();
                long regionSize = info.RegionSize.ToInt64();
                if (regionSize <= 0) break;
                long nextAddr = baseAddr + regionSize;
                if (nextAddr <= baseAddr) break;
                addr = new IntPtr(nextAddr);
                if (addr.ToInt64() >= 0x7FFFFFFF0000) break;
            }

            return regions;
        } finally {
            CloseHandle(hProcess);
        }
    }

    private static string GetProtectionString(uint protect) {
        if (protect == 0) return "NOACCESS";
        string s = "";
        if ((protect & 0x100) != 0) s += "NOACCESS ";
        if ((protect & PAGE_READONLY) != 0) s += "R ";
        if ((protect & PAGE_READWRITE) != 0) s += "RW ";
        if ((protect & PAGE_WRITECOPY) != 0) s += "W ";
        if ((protect & PAGE_EXECUTE) != 0) s += "X ";
        if ((protect & PAGE_EXECUTE_READ) != 0) s += "RX ";
        if ((protect & PAGE_EXECUTE_READWRITE) != 0) s += "RWX ";
        if ((protect & 0x100) != 0) s += "GUARD ";
        return s.Trim();
    }
}
"@

try {
    $regions = [RegionEnumerator]::EnumerateRegions(${pid})
    @{ success = $true; regions = $regions; count = $regions.Count } | ConvertTo-Json -Compress -Depth 10
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
  `.trim();
}

export async function enumerateRegions(
  platform: Platform,
  pid: number
): Promise<{ success: boolean; regions?: EnumeratedRegion[]; error?: string }> {
  if (platform !== 'win32' && platform !== 'darwin') {
    return { success: false, error: 'Region enumeration currently only implemented for Windows and macOS' };
  }

  if (platform === 'darwin') {
    try {
      const { stdout } = await execAsync(`vmmap -v ${pid}`, { timeout: 15000, maxBuffer: 1024 * 1024 * 5 });
      const regions: DarwinMemoryRegion[] = [];
      const regionRe = /^(\S[^\t]*?)\s{2,}([0-9a-f]+)-([0-9a-f]+)\s+\[.*?\]\s+([a-z-]+)\/([a-z-]+)/;
      for (const line of stdout.split('\n')) {
        const m = line.match(regionRe);
        if (!m) continue;
        const type = m[1]!;
        const start = m[2]!;
        const end = m[3]!;
        const prot = m[4]!;
        const maxProt = m[5]!;
        const startNum = parseInt(start, 16);
        const endNum = parseInt(end, 16);
        regions.push({
          baseAddress: `0x${start}`,
          size: endNum - startNum,
          type: type.trim(),
          protect: prot,
          maxProtect: maxProt,
          isReadable: prot.includes('r'),
          isWritable: prot.includes('w'),
          isExecutable: prot.includes('x'),
        });
      }
      return { success: true, regions };
    } catch (error) {
      logger.error('macOS region enumeration failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  try {
    const psScript = buildEnumerateRegionsScript(pid);
    const { stdout } = await executePowerShellScript(psScript, {
      maxBuffer: 1024 * 1024 * 10,
      timeout: 30000,
    });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return { success: result.success, regions: result.regions, error: result.error };
  } catch (error) {
    logger.error('Region enumeration failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed',
    };
  }
}
