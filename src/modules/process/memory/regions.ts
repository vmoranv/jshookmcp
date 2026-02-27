/**
 * Memory Regions - dump, enumerate regions, enumerate modules, check protection
 */

import { logger } from '../../../utils/logger.js';
import {
  execAsync,
  execFileAsync,
  executePowerShellScript,
  type Platform,
  type MemoryProtectionInfo,
} from './types.js';

// ---------------------------------------------------------------------------
// dumpMemoryRegion
// ---------------------------------------------------------------------------

function buildMemoryDumpScript(pid: number, address: number, size: number, outputPath: string): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.IO;
using System.ComponentModel;

public class MemoryDumper {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int read);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_VM_READ = 0x0010;
    const int PROCESS_QUERY_INFORMATION = 0x0400;

    public static string DumpMemory(int pid, long address, int size, string outputPath) {
        IntPtr hProcess = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            byte[] buffer = new byte[size];
            int bytesRead;

            if (!ReadProcessMemory(hProcess, (IntPtr)address, buffer, size, out bytesRead)) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to read memory");
            }

            File.WriteAllBytes(outputPath, buffer);
            return "Dumped " + bytesRead + " bytes to " + outputPath;
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [MemoryDumper]::DumpMemory(${pid}, ${address}, ${size}, "${outputPath.replace(/\\/g, '\\\\').replace(/"/g, '`"').replace(/\$/g, '`$')}")
    @{ success = $true; message = $result } | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
  `.trim();
}

export async function dumpMemoryRegion(
  platform: Platform,
  pid: number,
  startAddress: string,
  size: number,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  if (platform !== 'win32' && platform !== 'darwin') {
    return { success: false, error: 'Memory dump currently only implemented for Windows and macOS' };
  }

  if (platform === 'darwin') {
    const addrNum = parseInt(startAddress, 16);
    if (isNaN(addrNum)) return { success: false, error: 'Invalid address format' };
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: 'Invalid pid' };
    if (!Number.isInteger(size) || size <= 0) return { success: false, error: 'Invalid size' };
    const addrHex = `0x${addrNum.toString(16)}`;
    try {
      const { stdout } = await execFileAsync(
        'lldb',
        [
          '--batch',
          '-p',
          String(pid),
          '-o',
          `memory read --outfile ${outputPath} --binary ${addrHex} -c ${size}`,
          '-o',
          'process detach',
        ],
        { timeout: 60000, maxBuffer: 1024 * 1024 }
      );
      if (!stdout.includes('bytes written')) {
        const errLine = stdout.split('\n').find(l => l.includes('error:')) ?? stdout;
        return { success: false, error: `lldb dump failed: ${errLine.trim()}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  try {
    const addrNum = parseInt(startAddress, 16);
    if (isNaN(addrNum)) return { success: false, error: 'Invalid address format' };
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: 'Invalid pid' };
    if (!Number.isInteger(size) || size <= 0) return { success: false, error: 'Invalid size' };

    const psScript = buildMemoryDumpScript(pid, addrNum, size, outputPath);

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 60000 });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return { success: result.success, error: result.error };
  } catch (error) {
    logger.error('Memory dump failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed',
    };
  }
}

// ---------------------------------------------------------------------------
// enumerateRegions
// ---------------------------------------------------------------------------

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
): Promise<{ success: boolean; regions?: any[]; error?: string }> {
  if (platform !== 'win32' && platform !== 'darwin') {
    return { success: false, error: 'Region enumeration currently only implemented for Windows and macOS' };
  }

  if (platform === 'darwin') {
    try {
      const { stdout } = await execAsync(`vmmap -v ${pid}`, { timeout: 15000, maxBuffer: 1024 * 1024 * 5 });
      const regions: any[] = [];
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

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 });

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

// ---------------------------------------------------------------------------
// checkMemoryProtection
// ---------------------------------------------------------------------------

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
  if (platform !== 'win32' && platform !== 'darwin') {
    return { success: false, error: 'Memory protection check currently only implemented for Windows and macOS' };
  }

  if (platform === 'darwin') {
    try {
      const addrNum = parseInt(address, 16);
      if (isNaN(addrNum)) return { success: false, error: 'Invalid address format' };
      const { stdout } = await execAsync(`vmmap -v ${pid}`, { timeout: 15000, maxBuffer: 1024 * 1024 * 5 });
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

  try {
    const addrNum = parseInt(address, 16);
    if (isNaN(addrNum)) {
      return { success: false, error: 'Invalid address format' };
    }

    const psScript = buildProtectionCheckScript(pid, addrNum);

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 30000 });

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

// ---------------------------------------------------------------------------
// enumerateModules
// ---------------------------------------------------------------------------

export async function enumerateModules(
  platform: Platform,
  pid: number
): Promise<{ success: boolean; modules?: { name: string; baseAddress: string; size: number }[]; error?: string }> {
  if (platform !== 'win32') {
    return { success: false, error: 'Module enumeration currently only implemented for Windows' };
  }

  try {
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.ComponentModel;

public class ModuleEnumerator {
    [DllImport("psapi.dll", SetLastError = true)]
    public static extern bool EnumProcessModules(IntPtr hProcess, [Out] IntPtr[] lphModule, int cb, out int lpcbNeeded);

    [DllImport("psapi.dll", SetLastError = true)]
    public static extern int GetModuleBaseName(IntPtr hProcess, IntPtr hModule, [Out] System.Text.StringBuilder lpBaseName, int nSize);

    [DllImport("psapi.dll", SetLastError = true)]
    public static extern bool GetModuleInformation(IntPtr hProcess, IntPtr hModule, out MODULEINFO lpmodinfo, int cb);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_VM_READ = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    public struct MODULEINFO {
        public IntPtr lpBaseOfDll;
        public int SizeOfImage;
        public IntPtr EntryPoint;
    }

    public static object Enumerate(int pid) {
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process");
        }

        try {
            IntPtr[] modules = new IntPtr[1024];
            int cbNeeded;

            if (!EnumProcessModules(hProcess, modules, modules.Length * IntPtr.Size, out cbNeeded)) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "EnumProcessModules failed");
            }

            int numModules = cbNeeded / IntPtr.Size;
            var result = new List<object>();

            for (int i = 0; i < numModules; i++) {
                System.Text.StringBuilder baseName = new System.Text.StringBuilder(256);
                if (GetModuleBaseName(hProcess, modules[i], baseName, baseName.Capacity) > 0) {
                    MODULEINFO modInfo;
                    if (GetModuleInformation(hProcess, modules[i], out modInfo, Marshal.SizeOf(typeof(MODULEINFO)))) {
                        result.Add(new {
                            name = baseName.ToString(),
                            baseAddress = "0x" + modInfo.lpBaseOfDll.ToInt64().ToString("X"),
                            size = modInfo.SizeOfImage
                        });
                    }
                }
            }

            return new { success = true, modules = result };
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [ModuleEnumerator]::Enumerate(${pid})
    $result | ConvertTo-Json -Compress -Depth 10
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
    `;

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return result;
  } catch (error) {
    logger.error('Module enumeration failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed',
    };
  }
}
