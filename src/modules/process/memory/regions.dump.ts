import { logger } from '../../../utils/logger.js';
import { execFileAsync, executePowerShellScript, type Platform } from './types.js';

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
        const errLine = stdout.split('\n').find((l) => l.includes('error:')) ?? stdout;
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
