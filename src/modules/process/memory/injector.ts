/**
 * Memory Injector - DLL injection and shellcode injection (Windows only)
 */

import { logger } from '../../../utils/logger.js';
import { executePowerShellScript, type Platform } from './types.js';

// ---------------------------------------------------------------------------
// DLL Injection
// ---------------------------------------------------------------------------

function buildDllInjectionScript(pid: number, dllPath: string): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.IO;

public class DllInjector {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr addr, int size, int allocType, int protect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int written);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateRemoteThread(IntPtr hProcess, IntPtr attr, int stackSize, IntPtr startAddr, IntPtr param, int flags, out int threadId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetModuleHandle(string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetProcAddress(IntPtr hModule, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool VirtualFreeEx(IntPtr hProcess, IntPtr addr, int size, int freeType);

    const int PROCESS_CREATE_THREAD = 0x0002;
    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_VM_OPERATION = 0x0008;
    const int PROCESS_VM_WRITE = 0x0020;
    const int MEM_COMMIT = 0x1000;
    const int MEM_RESERVE = 0x2000;
    const int PAGE_READWRITE = 0x04;
    const int MEM_RELEASE = 0x8000;

    public static object Inject(int pid, string dllPath) {
        if (!File.Exists(dllPath)) {
            return new { success = false, error = "DLL not found: " + dllPath };
        }

        IntPtr hProcess = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            byte[] dllBytes = System.Text.Encoding.ASCII.GetBytes(dllPath + "\\0");
            IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, dllBytes.Length, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if (remoteMem == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to allocate memory in target");
            }

            try {
                int written;
                if (!WriteProcessMemory(hProcess, remoteMem, dllBytes, dllBytes.Length, out written)) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to write DLL path to target");
                }

                IntPtr hKernel32 = GetModuleHandle("kernel32.dll");
                IntPtr loadLibraryAddr = GetProcAddress(hKernel32, "LoadLibraryA");
                if (loadLibraryAddr == IntPtr.Zero) {
                    throw new Exception("Failed to get LoadLibraryA address");
                }

                int threadId;
                IntPtr hThread = CreateRemoteThread(hProcess, IntPtr.Zero, 0, loadLibraryAddr, remoteMem, 0, out threadId);
                if (hThread == IntPtr.Zero) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to create remote thread");
                }

                CloseHandle(hThread);
                return new { success = true, remoteThreadId = threadId };
            } finally {
                VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
            }
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [DllInjector]::Inject(${pid}, "${dllPath.replace(/\\/g, '\\\\').replace(/"/g, '`"').replace(/`/g, '``').replace(/\$/g, '`$')}")
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
  `.trim();
}

export async function injectDll(
  platform: Platform,
  pid: number,
  dllPath: string
): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
  if (platform !== 'win32') {
    return { success: false, error: 'DLL injection currently only implemented for Windows' };
  }

  try {
    const psScript = buildDllInjectionScript(pid, dllPath);

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 30000 });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return {
      success: result.success,
      remoteThreadId: result.remoteThreadId,
      error: result.error,
    };
  } catch (error) {
    logger.error('DLL injection failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Shellcode Injection
// ---------------------------------------------------------------------------

function buildShellcodeInjectionScript(pid: number, shellcode: Buffer): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class ShellcodeInjector {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr addr, int size, int allocType, int protect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int written);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateRemoteThread(IntPtr hProcess, IntPtr attr, int stackSize, IntPtr startAddr, IntPtr param, int flags, out int threadId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool VirtualProtectEx(IntPtr hProcess, IntPtr addr, int size, int newProtect, out int oldProtect);

    const int PROCESS_CREATE_THREAD = 0x0002;
    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_VM_OPERATION = 0x0008;
    const int PROCESS_VM_WRITE = 0x0020;
    const int MEM_COMMIT = 0x1000;
    const int MEM_RESERVE = 0x2000;
    const int PAGE_READWRITE = 0x04;
    const int PAGE_EXECUTE_READWRITE = 0x40;

    public static object Inject(int pid, byte[] shellcode) {
        IntPtr hProcess = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, shellcode.Length, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if (remoteMem == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to allocate memory in target");
            }

            try {
                int written;
                if (!WriteProcessMemory(hProcess, remoteMem, shellcode, shellcode.Length, out written)) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to write shellcode to target");
                }

                int oldProtect;
                if (!VirtualProtectEx(hProcess, remoteMem, shellcode.Length, PAGE_EXECUTE_READWRITE, out oldProtect)) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to change memory protection to executable");
                }

                int threadId;
                IntPtr hThread = CreateRemoteThread(hProcess, IntPtr.Zero, 0, remoteMem, IntPtr.Zero, 0, out threadId);
                if (hThread == IntPtr.Zero) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to create remote thread");
                }

                CloseHandle(hThread);
                return new { success = true, remoteThreadId = threadId };
            } finally {
                // Note: Memory is not freed to allow shellcode to execute
            }
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $shellcode = @(${Array.from(shellcode).join(',')})
    $result = [ShellcodeInjector]::Inject(${pid}, $shellcode)
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
  `.trim();
}

export async function injectShellcode(
  platform: Platform,
  pid: number,
  shellcode: string,
  encoding: 'hex' | 'base64' = 'hex'
): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
  if (platform !== 'win32') {
    return { success: false, error: 'Shellcode injection currently only implemented for Windows' };
  }

  try {
    let shellcodeBytes: Buffer;
    if (encoding === 'base64') {
      shellcodeBytes = Buffer.from(shellcode, 'base64');
    } else {
      const cleanHex = shellcode.replace(/\s/g, '');
      shellcodeBytes = Buffer.from(cleanHex, 'hex');
    }

    const psScript = buildShellcodeInjectionScript(pid, shellcodeBytes);

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 30000 });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return {
      success: result.success,
      remoteThreadId: result.remoteThreadId,
      error: result.error,
    };
  } catch (error) {
    logger.error('Shellcode injection failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed',
    };
  }
}
