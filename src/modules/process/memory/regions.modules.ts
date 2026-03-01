import { logger } from '../../../utils/logger.js';
import { executePowerShellScript, type Platform } from './types.js';

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
