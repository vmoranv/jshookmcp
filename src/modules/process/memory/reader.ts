/**
 * Memory Reader - platform-specific read implementations
 */

import { promises as fs } from 'node:fs';
import { logger } from '../../../utils/logger.js';
import { nativeMemoryManager } from '../../../native/NativeMemoryManager.js';
import { isKoffiAvailable } from '../../../native/Win32API.js';
import {
  execAsync,
  executePowerShellScript,
  type Platform,
  type MemoryReadResult,
  type MemoryProtectionInfo,
} from './types.js';

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

async function readMemoryWindows(pid: number, address: number, size: number): Promise<MemoryReadResult> {
  try {
    const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.ComponentModel;

          public class MemoryReader {
            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int read);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool CloseHandle(IntPtr handle);

            const int PROCESS_VM_READ = 0x0010;
            const int PROCESS_QUERY_INFORMATION = 0x0400;

            public static string ReadMemory(int pid, long address, int size) {
              IntPtr hProcess = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
              if (hProcess == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
              }

              try {
                byte[] buffer = new byte[size];
                int bytesRead;
                bool success = ReadProcessMemory(hProcess, (IntPtr)address, buffer, size, out bytesRead);

                if (!success) {
                  int error = Marshal.GetLastWin32Error();
                  throw new Win32Exception(error, "Failed to read memory");
                }

                return BitConverter.ToString(buffer, 0, bytesRead).Replace("-", " ");
              } finally {
                CloseHandle(hProcess);
              }
            }
          }
"@

        try {
          $result = [MemoryReader]::ReadMemory(${pid}, ${address}, ${size})
          @{ success = $true; data = $result } | ConvertTo-Json -Compress
        } catch {
          @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
        }
      `;

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 * 10 });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    const result = JSON.parse(_trimmed);
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  } catch (error) {
    logger.error('Windows memory read failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed. Run as Administrator.',
    };
  }
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

async function readMemoryLinux(pid: number, address: number, size: number): Promise<MemoryReadResult> {
  try {
    const { stdout } = await execAsync(
      `sudo dd if=/proc/${pid}/mem bs=1 skip=${address} count=${size} 2>/dev/null | xxd -p | tr -d '\\n' || echo ""`,
      { maxBuffer: 1024 * 1024 * 10, timeout: 10000 }
    );

    if (!stdout.trim()) {
      return {
        success: false,
        error: 'Failed to read memory. Requires root privileges or ptrace access.',
      };
    }

    const hexData = stdout.trim().match(/.{1,2}/g)?.join(' ') || stdout.trim();

    return {
      success: true,
      data: hexData.toUpperCase(),
    };
  } catch (error) {
    logger.error('Linux memory read failed:', error);
    return {
      success: false,
      error: 'Memory read failed. Run as root or use ptrace.',
    };
  }
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

async function readMemoryMac(
  pid: number,
  address: number,
  size: number,
  checkProtectionFn: (pid: number, address: string) => Promise<MemoryProtectionInfo>
): Promise<MemoryReadResult> {
  if (address === 0) {
    return { success: false, error: 'Invalid address: null pointer (0x0)' };
  }
  const MAX_READ_SIZE = 16 * 1024 * 1024;
  if (size <= 0 || size > MAX_READ_SIZE) {
    return { success: false, error: `Invalid size: must be 1–${MAX_READ_SIZE} bytes` };
  }
  const addrHex = `0x${address.toString(16)}`;
  const prot = await checkProtectionFn(pid, addrHex);
  if (!prot.success) {
    return { success: false, error: `Cannot verify memory region: ${prot.error}` };
  }
  if (!prot.isReadable) {
    return { success: false, error: `Address ${addrHex} is not readable (protection: ${prot.protection ?? 'unknown'})` };
  }

  const tmpFile = `/tmp/mread_${pid}_${Date.now()}.bin`;
  try {
    const { stdout } = await execAsync(
      `lldb --batch -p ${pid} -o "memory read --outfile ${tmpFile} --binary ${addrHex} -c ${size}" -o "process detach"`,
      { timeout: 15000, maxBuffer: 1024 * 1024 * 10 }
    );
    if (!stdout.includes('bytes written')) {
      const errLine = stdout.split('\n').find(l => l.includes('error:')) ?? stdout;
      return { success: false, error: `lldb memory read failed: ${errLine.trim()}` };
    }
    const data = await fs.readFile(tmpFile);
    const hex = Array.from(data)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    return { success: true, data: hex };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

export async function readMemory(
  platform: Platform,
  pid: number,
  address: string,
  size: number,
  checkProtectionFn: (pid: number, address: string) => Promise<MemoryProtectionInfo>
): Promise<MemoryReadResult> {
  try {
    const addrNum = parseInt(address, 16);
    if (isNaN(addrNum)) {
      return { success: false, error: 'Invalid address format. Use hex like "0x12345678"' };
    }

    // Try native FFI first on Windows (10-100x faster)
    if (platform === 'win32' && isKoffiAvailable()) {
      try {
        const result = await nativeMemoryManager.readMemory(pid, address, size);
        if (result.success) {
          logger.debug('Native memory read succeeded');
          return result;
        }
        logger.warn('Native memory read failed, falling back to PowerShell:', result.error);
      } catch (nativeError) {
        logger.warn('Native memory read error, falling back to PowerShell:', nativeError);
      }
    }

    switch (platform) {
      case 'win32':
        return readMemoryWindows(pid, addrNum, size);
      case 'linux':
        return readMemoryLinux(pid, addrNum, size);
      case 'darwin':
        return readMemoryMac(pid, addrNum, size, checkProtectionFn);
      default:
        return { success: false, error: `Memory operations not supported on platform: ${platform}` };
    }
  } catch (error) {
    logger.error('Memory read failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
