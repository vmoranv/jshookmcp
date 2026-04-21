/**
 * Memory Injector - DLL injection and shellcode injection (Windows, Linux, macOS)
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@utils/logger';
import { MEMORY_INJECT_TIMEOUT_MS } from '@src/constants';
import { executePowerShellScript, execAsync, type Platform } from '@modules/process/memory/types';

// Reject paths containing shell metacharacters to prevent command injection.
function validatePath(p: string): void {
  if (/[`$"';|<>&()\\\n\r]/.test(p)) {
    throw new Error(`Path contains unsafe characters: ${p}`);
  }
}

// ── DLL Injection ──

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
  dllPath: string,
): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
  if (platform === 'linux') {
    try {
      validatePath(dllPath);
      const { stderr } = await execAsync(
        `gdb -p ${pid} -batch -ex "call (void*)dlopen(\\"${dllPath}\\", 1)" -ex "quit"`,
        { timeout: MEMORY_INJECT_TIMEOUT_MS },
      );
      if (stderr.includes('Operation not permitted') || stderr.includes('ptrace:')) {
        throw new Error(`GDB injection failed (ptrace blocked): ${stderr}`);
      }
      return { success: true };
    } catch (error) {
      logger.error('Linux DLL injection failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  } else if (platform === 'darwin') {
    try {
      validatePath(dllPath);
      const { stdout, stderr } = await execAsync(
        `lldb --batch -p ${pid} -o "expr (void*)dlopen(\\"${dllPath}\\", 1)"`,
        { timeout: MEMORY_INJECT_TIMEOUT_MS },
      );
      if (stderr.includes('error:') || stdout.includes('error:')) {
        throw new Error(`LLDB injection failed: ${stderr || stdout}`);
      }
      return { success: true };
    } catch (error) {
      logger.error('macOS DLL injection failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  } else if (platform !== 'win32') {
    return { success: false, error: 'DLL injection not supported on this platform' };
  }

  try {
    const psScript = buildDllInjectionScript(pid, dllPath);

    const { stdout } = await executePowerShellScript(psScript, {
      maxBuffer: 1024 * 1024,
      timeout: MEMORY_INJECT_TIMEOUT_MS,
    });

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

// ── Shellcode Injection ──

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
  encoding: 'hex' | 'base64' = 'hex',
): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
  try {
    let shellcodeBytes: Buffer;
    if (encoding === 'base64') {
      shellcodeBytes = Buffer.from(shellcode, 'base64');
    } else {
      const cleanHex = shellcode.replace(/\s/g, '');
      shellcodeBytes = Buffer.from(cleanHex, 'hex');
    }

    if (platform === 'linux') {
      const byteList = Array.from(shellcodeBytes)
        .map((b) => `\\x${b.toString(16).padStart(2, '0')}`)
        .join('');
      const pyScript = `
import gdb
import sys

def inject():
    try:
        # mmap: PROT_READ|PROT_WRITE|PROT_EXEC (7), MAP_PRIVATE|MAP_ANONYMOUS (34)
        mmap_res = gdb.parse_and_eval("(void*)mmap(0, ${shellcodeBytes.length}, 7, 34, -1, 0)")
        addr = int(mmap_res)
        if addr == -1 or addr == 0:
            print("ERROR_INJECT: mmap failed")
            return
            
        inf = gdb.selected_inferior()
        inf.write_memory(addr, b"${byteList}")
        
        # Call it directly (creates a crash potentially) or via pthread_create
        # Let's use pthread_create
        thread_t = gdb.parse_and_eval("(void*)malloc(8)")
        res = gdb.parse_and_eval(f"(int)pthread_create({int(thread_t)}, 0, {addr}, 0)")
        
        print(f"SUCCESS_INJECT: {int(res)}")
    except Exception as e:
        print(f"ERROR_INJECT: {str(e)}")

inject()
`;
      const scriptPath = join(tmpdir(), `gdb_inject_${pid}_${Date.now()}.py`);
      await fs.writeFile(scriptPath, pyScript, 'utf8');
      try {
        const { stdout, stderr } = await execAsync(`gdb -p ${pid} -batch -x ${scriptPath}`, {
          timeout: MEMORY_INJECT_TIMEOUT_MS,
        });
        if (stdout.includes('ERROR_INJECT:') || stderr.includes('ERROR_INJECT:')) {
          throw new Error(`GDB injection failed: ${stdout || stderr}`);
        }
        return { success: true };
      } finally {
        await fs.unlink(scriptPath).catch(() => {});
      }
    } else if (platform === 'darwin') {
      const byteList = Array.from(shellcodeBytes)
        .map((b) => b.toString())
        .join(',');
      const pyScript = `
import lldb
import sys

def __lldb_init_module(debugger, internal_dict):
    try:
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        
        # mmap: PROT_READ|PROT_WRITE|PROT_EXEC (7), MAP_PRIVATE|MAP_ANON (4098 on macOS)
        res = lldb.SBCommandReturnObject()
        debugger.GetCommandInterpreter().HandleCommand("expr (void*)mmap(0, ${shellcodeBytes.length}, 7, 4098, -1, 0)", res)
        
        if not res.Succeeded():
            print("ERROR_INJECT: " + res.GetError())
            return
            
        addr_str = res.GetOutput().split()[-1]
        addr = int(addr_str, 16)
        
        err = lldb.SBError()
        bytes_data = bytes([${byteList}])
        process.WriteMemory(addr, bytes_data, err)
        
        if not err.Success():
            print("ERROR_INJECT: write failed")
            return
            
        # create thread
        res2 = lldb.SBCommandReturnObject()
        debugger.GetCommandInterpreter().HandleCommand(f"expr (int)pthread_create((void*)malloc(8), 0, (void*){addr}, 0)", res2)
        
        print("SUCCESS_INJECT")
    except Exception as e:
        print("ERROR_INJECT: " + str(e))
`;
      const pyFile = join(tmpdir(), `lldb_inject_${pid}_${Date.now()}.py`);
      const cmdFile = join(tmpdir(), `lldb_inject_cmd_${pid}_${Date.now()}.txt`);
      await fs.writeFile(pyFile, pyScript, 'utf8');
      await fs.writeFile(cmdFile, `command script import ${pyFile}\\nprocess detach\\n`, 'utf8');
      try {
        const { stdout } = await execAsync(`lldb --batch -p ${pid} --source ${cmdFile}`, {
          timeout: MEMORY_INJECT_TIMEOUT_MS,
        });
        if (stdout.includes('ERROR_INJECT:')) {
          throw new Error(`LLDB injection failed: ${stdout}`);
        }
        return { success: true };
      } finally {
        await fs.unlink(pyFile).catch(() => {});
        await fs.unlink(cmdFile).catch(() => {});
      }
    } else if (platform !== 'win32') {
      return { success: false, error: 'Shellcode injection not supported on this platform' };
    }

    const psScript = buildShellcodeInjectionScript(pid, shellcodeBytes);

    const { stdout } = await executePowerShellScript(psScript, {
      maxBuffer: 1024 * 1024,
      timeout: MEMORY_INJECT_TIMEOUT_MS,
    });

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
      error: error instanceof Error ? error.message : 'Execution failed',
    };
  }
}
