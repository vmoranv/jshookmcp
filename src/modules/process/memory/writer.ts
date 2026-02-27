/**
 * Memory Writer - platform-specific write implementations + batch write
 */

import { logger } from '../../../utils/logger.js';
import { nativeMemoryManager } from '../../../native/NativeMemoryManager.js';
import { isKoffiAvailable } from '../../../native/Win32API.js';
import {
  execAsync,
  executePowerShellScript,
  type Platform,
  type MemoryWriteResult,
  type MemoryProtectionInfo,
  type MemoryPatch,
} from './types.js';

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

async function writeMemoryWindows(pid: number, address: number, data: Buffer): Promise<MemoryWriteResult> {
  try {
    const hexData = data.toString('hex').toUpperCase();

    const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.ComponentModel;

          public class MemoryWriter {
            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int written);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool CloseHandle(IntPtr handle);

            const int PROCESS_VM_WRITE = 0x0020;
            const int PROCESS_VM_OPERATION = 0x0008;

            public static int WriteMemory(int pid, long address, string hexData) {
              IntPtr hProcess = OpenProcess(PROCESS_VM_WRITE | PROCESS_VM_OPERATION, false, pid);
              if (hProcess == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
              }

              try {
                byte[] buffer = new byte[hexData.Length / 2];
                for (int i = 0; i < hexData.Length; i += 2) {
                  buffer[i / 2] = Convert.ToByte(hexData.Substring(i, 2), 16);
                }

                int bytesWritten;
                bool success = WriteProcessMemory(hProcess, (IntPtr)address, buffer, buffer.Length, out bytesWritten);

                if (!success) {
                  int error = Marshal.GetLastWin32Error();
                  throw new Win32Exception(error, "Failed to write memory");
                }

                return bytesWritten;
              } finally {
                CloseHandle(hProcess);
              }
            }
          }
"@

        try {
          $bytesWritten = [MemoryWriter]::WriteMemory(${pid}, ${address}, "${hexData}")
          @{ success = $true; bytesWritten = $bytesWritten } | ConvertTo-Json -Compress
        } catch {
          @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
        }
      `;

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return {
      success: result.success,
      bytesWritten: result.bytesWritten,
      error: result.error,
    };
  } catch (error) {
    logger.error('Windows memory write failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed. Run as Administrator.',
    };
  }
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

async function writeMemoryLinux(pid: number, address: number, data: Buffer): Promise<MemoryWriteResult> {
  try {
    const hexData = data.toString('hex');

    const { stderr } = await execAsync(
      `sudo sh -c 'printf "${hexData}" | xxd -r -p | dd of=/proc/${pid}/mem bs=1 seek=${address} conv=notrunc 2>&1' || echo ""`,
      { maxBuffer: 1024 * 1024, timeout: 10000 }
    );

    if (stderr && stderr.includes('error')) {
      return {
        success: false,
        error: 'Memory write failed. Requires root privileges.',
      };
    }

    return {
      success: true,
      bytesWritten: data.length,
    };
  } catch (error) {
    logger.error('Linux memory write failed:', error);
    return {
      success: false,
      error: 'Memory write failed. Run as root.',
    };
  }
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

async function writeMemoryMac(
  pid: number,
  address: number,
  data: Buffer,
  checkProtectionFn: (pid: number, address: string) => Promise<MemoryProtectionInfo>
): Promise<MemoryWriteResult> {
  if (address === 0) {
    return { success: false, error: 'Invalid address: null pointer (0x0)' };
  }
  const MAX_WRITE_SIZE = 16 * 1024;
  if (data.length === 0 || data.length > MAX_WRITE_SIZE) {
    return { success: false, error: `Invalid write size: must be 1–${MAX_WRITE_SIZE} bytes` };
  }
  const addrHex = `0x${address.toString(16)}`;
  const prot = await checkProtectionFn(pid, addrHex);
  if (!prot.success) {
    return { success: false, error: `Cannot verify memory region: ${prot.error}` };
  }
  if (!prot.isWritable) {
    return { success: false, error: `Address ${addrHex} is not writable (protection: ${prot.protection ?? 'unknown'})` };
  }

  try {
    const hexBytes = Array.from(data)
      .map(b => `0x${b.toString(16).padStart(2, '0')}`)
      .join(' ');
    const { stdout } = await execAsync(
      `lldb --batch -p ${pid} -o "memory write ${addrHex} ${hexBytes}" -o "process detach"`,
      { timeout: 10000, maxBuffer: 1024 * 1024 }
    );
    if (stdout.includes('error:')) {
      const errLine = stdout.split('\n').find(l => l.includes('error:')) ?? stdout;
      return { success: false, error: `lldb memory write failed: ${errLine.trim()}` };
    }
    return { success: true, bytesWritten: data.length };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Public dispatchers
// ---------------------------------------------------------------------------

export async function writeMemory(
  platform: Platform,
  pid: number,
  address: string,
  data: string,
  encoding: 'hex' | 'base64' = 'hex',
  checkProtectionFn: (pid: number, address: string) => Promise<MemoryProtectionInfo>
): Promise<MemoryWriteResult> {
  try {
    const addrNum = parseInt(address, 16);
    if (isNaN(addrNum)) {
      return { success: false, error: 'Invalid address format' };
    }

    let buffer: Buffer;
    try {
      if (encoding === 'base64') {
        buffer = Buffer.from(data, 'base64');
      } else {
        const cleanHex = data.replace(/\s/g, '');
        buffer = Buffer.from(cleanHex, 'hex');
      }
    } catch (e) {
      return { success: false, error: `Invalid ${encoding} data` };
    }

    // Try native FFI first on Windows (10-100x faster)
    if (platform === 'win32' && isKoffiAvailable()) {
      try {
        const result = await nativeMemoryManager.writeMemory(pid, address, data, encoding);
        if (result.success) {
          logger.debug('Native memory write succeeded');
          return result;
        }
        logger.warn('Native memory write failed, falling back to PowerShell:', result.error);
      } catch (nativeError) {
        logger.warn('Native memory write error, falling back to PowerShell:', nativeError);
      }
    }

    switch (platform) {
      case 'win32':
        return writeMemoryWindows(pid, addrNum, buffer);
      case 'linux':
        return writeMemoryLinux(pid, addrNum, buffer);
      case 'darwin':
        return writeMemoryMac(pid, addrNum, buffer, checkProtectionFn);
      default:
        return { success: false, error: `Memory operations not supported on platform: ${platform}` };
    }
  } catch (error) {
    logger.error('Memory write failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function batchMemoryWrite(
  pid: number,
  patches: MemoryPatch[],
  writeFn: (pid: number, address: string, data: string, encoding: 'hex' | 'base64') => Promise<MemoryWriteResult>
): Promise<{ success: boolean; results: { address: string; success: boolean; error?: string }[]; error?: string }> {
  const results: { address: string; success: boolean; error?: string }[] = [];

  for (const patch of patches) {
    const result = await writeFn(pid, patch.address, patch.data, patch.encoding || 'hex');
    results.push({
      address: patch.address,
      success: result.success,
      error: result.error,
    });
  }

  const allSuccess = results.every(r => r.success);
  return {
    success: allSuccess,
    results,
    error: allSuccess
      ? undefined
      : `Failed to write ${results.filter(r => !r.success).length} of ${results.length} patches`,
  };
}
