/**
 * Memory Injector - DLL injection and shellcode injection (Windows, Linux, macOS)
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@utils/logger';
import { MEMORY_INJECT_TIMEOUT_MS } from '@src/constants';
import { executePowerShellScript, execAsync, type Platform } from '@modules/process/memory/types';
import {
  createValidatorFromEnv,
  InjectionValidator,
  InjectionValidationMode,
  type InjectionValidatorConfig,
} from './injection-validator';

// Reject paths containing shell metacharacters to prevent command injection.
function validatePath(p: string): void {
  if (/[`$"';|<>&()\\\n\r]/.test(p)) {
    throw new Error(`Path contains unsafe characters: ${p}`);
  }
}

// Shared validator instance (lazy-initialized)
let validator: InjectionValidator | null = null;
function getValidator(modeOverride?: string): InjectionValidator {
  if (modeOverride) {
    // Create a new validator with the override mode
    const mode = Object.values(InjectionValidationMode).includes(
      modeOverride as InjectionValidationMode,
    )
      ? (modeOverride as InjectionValidationMode)
      : InjectionValidationMode.BALANCED;

    const config: InjectionValidatorConfig = {
      mode,
      maxShellcodeSize: 1024 * 1024,
      requireHashForDll: mode === InjectionValidationMode.STRICT,
    };

    return new InjectionValidator(config);
  }

  if (!validator) {
    validator = createValidatorFromEnv();
  }
  return validator;
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
    // Backtick doubling MUST run first: later escapes introduce backticks that
    // would otherwise be doubled into literals (string breakout).
    $result = [DllInjector]::Inject(${pid}, "${dllPath.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$')}")
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
  `.trim();
}

/** Result shape shared by the validation gate and the injection phase. */
interface InjectionOutcome {
  success: boolean;
  remoteThreadId?: number;
  error?: string;
  confirmationRequired?: boolean;
  validationFailed?: boolean;
}

/**
 * Run the pre-injection validation gate.
 *
 * Returns `null` when the caller may proceed, or the failure outcome to return
 * verbatim. Skipped entirely when `confirmed` is set — that flag exists to let
 * an operator bypass validation after an explicit confirmation.
 *
 * A thrown validator is reported as `validationFailed` rather than escaping:
 * the injection path must not start on an unvalidated target.
 */
async function runInjectionValidation(
  pid: number,
  dllPath: string,
  options: { confirmed?: boolean; payloadHash?: string; validationMode?: string } | undefined,
): Promise<InjectionOutcome | null> {
  // getValidator runs BEFORE the confirmed check, matching the original: it is
  // a cheap factory but its side effects (or throws) must not be skipped just
  // because the caller confirmed.
  const injectionValidator = getValidator(options?.validationMode);

  if (options?.confirmed) {
    return null;
  }

  try {
    // Validate target process
    const targetValidation = await injectionValidator.validateTargetProcess(pid);
    if (!targetValidation.valid) {
      return {
        success: false,
        error: targetValidation.errors.join('; '),
        validationFailed: true,
      };
    }

    // Validate DLL payload
    const payloadValidation = await injectionValidator.validateDllPayload(dllPath, {
      expectedHash: options?.payloadHash,
    });
    if (!payloadValidation.valid) {
      return {
        success: false,
        error: payloadValidation.errors.join('; '),
        validationFailed: true,
      };
    }

    // Check if confirmation is required
    const confirmationReq = injectionValidator.requireConfirmation(
      targetValidation,
      payloadValidation,
    );
    if (confirmationReq.required) {
      return {
        success: false,
        error: confirmationReq.reason || 'Confirmation required',
        confirmationRequired: true,
        validationFailed: true,
      };
    }

    // Log warnings (non-blocking)
    if (targetValidation.warnings.length > 0) {
      logger.warn(`DLL injection warnings (target): ${targetValidation.warnings.join('; ')}`);
    }
    if (payloadValidation.warnings.length > 0) {
      logger.warn(`DLL injection warnings (payload): ${payloadValidation.warnings.join('; ')}`);
    }
  } catch (validationError) {
    logger.error('Validation error during DLL injection:', validationError);
    return {
      success: false,
      error: `Validation error: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
      validationFailed: true,
    };
  }
  return null;
}

/** Linux: dlopen through a gdb batch session. */
async function injectDllLinux(pid: number, dllPath: string): Promise<InjectionOutcome> {
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
}

/** Darwin: dlopen through an lldb batch session. */
async function injectDllDarwin(pid: number, dllPath: string): Promise<InjectionOutcome> {
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
}

/** Windows: PowerShell helper that calls CreateRemoteThread + LoadLibrary. */
async function injectDllWindows(pid: number, dllPath: string): Promise<InjectionOutcome> {
  try {
    const psScript = buildDllInjectionScript(pid, dllPath);

    const { stdout } = await executePowerShellScript(psScript, {
      maxBuffer: 1024 * 1024,
      timeout: MEMORY_INJECT_TIMEOUT_MS,
    });

    const trimmed = stdout.trim();
    if (!trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(trimmed);
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

export async function injectDll(
  platform: Platform,
  pid: number,
  dllPath: string,
  options?: { confirmed?: boolean; payloadHash?: string; validationMode?: string },
): Promise<InjectionOutcome> {
  // Validation phase
  const validationFailure = await runInjectionValidation(pid, dllPath, options);
  if (validationFailure) {
    return validationFailure;
  }

  // Injection phase
  if (platform === 'linux') {
    return injectDllLinux(pid, dllPath);
  }
  if (platform === 'darwin') {
    return injectDllDarwin(pid, dllPath);
  }
  if (platform !== 'win32') {
    return { success: false, error: 'DLL injection not supported on this platform' };
  }
  return injectDllWindows(pid, dllPath);
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
  options?: { confirmed?: boolean; validationMode?: string },
): Promise<{
  success: boolean;
  remoteThreadId?: number;
  error?: string;
  confirmationRequired?: boolean;
  validationFailed?: boolean;
}> {
  // Validation phase
  const injectionValidator = getValidator(options?.validationMode);

  // Skip validation if confirmed flag is set or validation is disabled
  if (!options?.confirmed) {
    try {
      // Validate target process
      const targetValidation = await injectionValidator.validateTargetProcess(pid);
      if (!targetValidation.valid) {
        return {
          success: false,
          error: targetValidation.errors.join('; '),
          validationFailed: true,
        };
      }

      // Validate shellcode payload
      const payloadValidation = await injectionValidator.validateShellcodePayload(
        shellcode,
        encoding,
      );
      if (!payloadValidation.valid) {
        return {
          success: false,
          error: payloadValidation.errors.join('; '),
          validationFailed: true,
        };
      }

      // Check if confirmation is required
      const confirmationReq = injectionValidator.requireConfirmation(
        targetValidation,
        payloadValidation,
      );
      if (confirmationReq.required) {
        return {
          success: false,
          error: confirmationReq.reason || 'Confirmation required',
          confirmationRequired: true,
          validationFailed: true,
        };
      }

      // Log warnings (non-blocking)
      if (targetValidation.warnings.length > 0) {
        logger.warn(
          `Shellcode injection warnings (target): ${targetValidation.warnings.join('; ')}`,
        );
      }
      if (payloadValidation.warnings.length > 0) {
        logger.warn(
          `Shellcode injection warnings (payload): ${payloadValidation.warnings.join('; ')}`,
        );
      }
    } catch (validationError) {
      logger.error('Validation error during shellcode injection:', validationError);
      return {
        success: false,
        error: `Validation error: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
        validationFailed: true,
      };
    }
  }

  // Injection phase (unchanged from original)
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

    const trimmed = stdout.trim();
    if (!trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(trimmed);
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
