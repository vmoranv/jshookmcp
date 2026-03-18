import { readFileSync } from 'fs';
import { logger } from '@utils/logger';
import {
  execAsync,
  executePowerShellScript,
  type MemoryProtectionInfo,
  type Platform,
} from '@modules/process/memory/types';
import { parseProcMaps, formatLinuxProtection } from './linux/mapsParser';
import { nativeMemoryManager } from '../../../native/NativeMemoryManager';
import { isKoffiAvailable } from '../../../native/NativeMemoryManager.utils';

function buildProtectionCheckScript(pid: number, address: number): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class ProtectionChecker {
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
    const uint PAGE_NOACCESS = 0x01;
    const uint PAGE_READONLY = 0x02;
    const uint PAGE_READWRITE = 0x04;
    const uint PAGE_WRITECOPY = 0x08;
    const uint PAGE_EXECUTE = 0x10;
    const uint PAGE_EXECUTE_READ = 0x20;
    const uint PAGE_EXECUTE_READWRITE = 0x40;
    const uint PAGE_EXECUTE_WRITECOPY = 0x80;
    const uint PAGE_GUARD = 0x100;

    public static object CheckProtection(int pid, long address) {
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            MEMORY_BASIC_INFORMATION info;
            int infoSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
            int result = VirtualQueryEx(hProcess, (IntPtr)address, out info, infoSize);

            if (result != infoSize) {
                return new { success = false, error = "Failed to query memory region" };
            }

            if (info.State != MEM_COMMIT) {
                return new {
                    success = true,
                    protection = "NOT_COMMITTED",
                    isWritable = false,
                    isReadable = false,
                    isExecutable = false,
                    regionStart = "0x" + info.BaseAddress.ToInt64().ToString("X"),
                    regionSize = info.RegionSize.ToInt64()
                };
            }

            uint protect = info.Protect;
            string protectionStr = "";
            bool isWritable = false;
            bool isReadable = false;
            bool isExecutable = false;

            if ((protect & PAGE_NOACCESS) != 0) protectionStr += "NOACCESS ";
            if ((protect & PAGE_READONLY) != 0) { protectionStr += "R "; isReadable = true; }
            if ((protect & PAGE_READWRITE) != 0) { protectionStr += "RW "; isReadable = true; isWritable = true; }
            if ((protect & PAGE_WRITECOPY) != 0) { protectionStr += "WC "; isReadable = true; isWritable = true; }
            if ((protect & PAGE_EXECUTE) != 0) { protectionStr += "X "; isExecutable = true; }
            if ((protect & PAGE_EXECUTE_READ) != 0) { protectionStr += "RX "; isReadable = true; isExecutable = true; }
            if ((protect & PAGE_EXECUTE_READWRITE) != 0) { protectionStr += "RWX "; isReadable = true; isWritable = true; isExecutable = true; }
            if ((protect & PAGE_EXECUTE_WRITECOPY) != 0) { protectionStr += "RWCX "; isReadable = true; isWritable = true; isExecutable = true; }
            if ((protect & PAGE_GUARD) != 0) protectionStr += "GUARD ";

            return new {
                success = true,
                protection = protectionStr.Trim(),
                isWritable = isWritable,
                isReadable = isReadable,
                isExecutable = isExecutable,
                regionStart = "0x" + info.BaseAddress.ToInt64().ToString("X"),
                regionSize = info.RegionSize.ToInt64()
            };
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [ProtectionChecker]::CheckProtection(${pid}, ${address})
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
  `.trim();
}

export async function checkMemoryProtection(
  platform: Platform,
  pid: number,
  address: string
): Promise<MemoryProtectionInfo> {
  // Parse address once for all platforms
  const addrNum = BigInt(address.startsWith('0x') ? address : `0x${address}`);

  // Linux: synchronous /proc/pid/maps read
  if (platform === 'linux') {
    try {
      const mapsContent = readFileSync(`/proc/${pid}/maps`, 'utf-8');
      const regions = parseProcMaps(mapsContent);
      const region = regions.find((r) => addrNum >= r.start && addrNum < r.end);
      if (!region) {
        return { success: false, error: `Address ${address} not found in any memory region` };
      }
      return {
        success: true,
        protection: formatLinuxProtection(region.permissions),
        isReadable: region.permissions.read,
        isWritable: region.permissions.write,
        isExecutable: region.permissions.exec,
        regionStart: `0x${region.start.toString(16)}`,
        regionSize: Number(region.end - region.start),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (platform === 'darwin') {
    try {
      const addrNum = parseInt(address, 16);
      if (isNaN(addrNum)) return { success: false, error: 'Invalid address format' };
      const { stdout } = await execAsync(`vmmap -v ${pid}`, {
        timeout: 15000,
        maxBuffer: 1024 * 1024 * 5,
      });
      const regionRe = /^(\S[^\t]*?)\s{2,}([0-9a-f]+)-([0-9a-f]+)\s+\[.*?\]\s+([a-z-]+)\/([a-z-]+)/;
      for (const line of stdout.split('\n')) {
        const m = line.match(regionRe);
        if (!m) continue;
        const start = parseInt(m[2]!, 16);
        const end = parseInt(m[3]!, 16);
        if (addrNum >= start && addrNum < end) {
          const prot = m[4]!;
          return {
            success: true,
            protection: prot,
            isReadable: prot.includes('r'),
            isWritable: prot.includes('w'),
            isExecutable: prot.includes('x'),
            regionStart: `0x${m[2]!}`,
            regionSize: end - start,
          };
        }
      }
      return { success: false, error: `Address ${address} not found in any memory region` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // Windows: try native first, fall back to PowerShell
  if (isKoffiAvailable()) {
    try {
      const nativeResult = await nativeMemoryManager.checkMemoryProtection(pid, address);
      if (nativeResult.success) {
        return nativeResult;
      }

      logger.warn('Native Windows memory protection check failed, falling back to PowerShell', {
        pid,
        address,
        error: nativeResult.error,
        nativeAvailable: isKoffiAvailable(),
      });
    } catch (error) {
      logger.warn('Native Windows memory protection check threw, falling back to PowerShell', {
        pid,
        address,
        error: error instanceof Error ? error.message : String(error),
        nativeAvailable: isKoffiAvailable(),
      });
    }
  }

  try {
    const addrNum = parseInt(address, 16);
    if (isNaN(addrNum)) {
      return { success: false, error: 'Invalid address format' };
    }

    const psScript = buildProtectionCheckScript(pid, addrNum);
    const { stdout } = await executePowerShellScript(psScript, {
      maxBuffer: 1024 * 1024,
      timeout: 30000,
    });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return {
      success: result.success,
      protection: result.protection,
      isWritable: result.isWritable,
      isReadable: result.isReadable,
      isExecutable: result.isExecutable,
      regionStart: result.regionStart,
      regionSize: result.regionSize,
      error: result.error,
    };
  } catch (error) {
    logger.error('Memory protection check failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed',
    };
  }
}
