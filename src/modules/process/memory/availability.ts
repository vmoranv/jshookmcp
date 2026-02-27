/**
 * Availability checker - determines whether memory operations can run on the
 * current platform/privilege level.  Includes a TTL cache for the Windows
 * Administrator check to avoid repeated PowerShell spawns.
 */

import { executePowerShellScript, execAsync, type Platform } from './types.js';

const WINDOWS_CACHE_TTL_MS = 45_000;

let windowsAvailabilityCache: { expiresAt: number; result: { available: boolean; reason?: string } } | null = null;

function getExecErrorStream(error: unknown, key: 'stderr' | 'stdout'): string {
  if (typeof error !== 'object' || error === null) return '';
  const stream = (error as Record<string, unknown>)[key];
  return typeof stream === 'string' ? stream : '';
}

function getWindowsAvailabilityFailureReason(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stderr = getExecErrorStream(error, 'stderr');
  const combined = `${errorMessage}\n${stderr}`.toLowerCase();

  if (
    combined.includes('enoent') ||
    combined.includes('command not found') ||
    combined.includes('is not recognized as an internal or external command') ||
    (combined.includes('cannot find') && combined.includes('powershell'))
  ) {
    return 'PowerShell is unavailable. Windows memory operations require powershell.exe to verify Administrator privileges.';
  }

  return `PowerShell command execution failed while checking Administrator privileges: ${errorMessage}`;
}

async function runWindowsAdminAvailabilityCheck(): Promise<{ available: boolean; reason?: string }> {
  try {
    const { stdout } = await executePowerShellScript(
      '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
      { timeout: 5000 }
    );
    const normalizedOutput = stdout.trim().toLowerCase();

    if (normalizedOutput === 'true') {
      return { available: true };
    }

    if (normalizedOutput === 'false') {
      return {
        available: false,
        reason: 'Windows memory operations require Administrator privileges. Please run your terminal/IDE as Administrator and retry.',
      };
    }

    return {
      available: false,
      reason: `PowerShell command execution failed while checking Administrator privileges: unexpected output "${stdout.trim() || '(empty)'}".`,
    };
  } catch (error) {
    return {
      available: false,
      reason: getWindowsAvailabilityFailureReason(error),
    };
  }
}

async function checkWindowsAvailability(): Promise<{ available: boolean; reason?: string }> {
  const now = Date.now();
  if (windowsAvailabilityCache && windowsAvailabilityCache.expiresAt > now) {
    return windowsAvailabilityCache.result;
  }

  const result = await runWindowsAdminAvailabilityCheck();
  windowsAvailabilityCache = { expiresAt: now + WINDOWS_CACHE_TTL_MS, result };
  return result;
}

export async function checkAvailability(platform: Platform): Promise<{ available: boolean; reason?: string }> {
  switch (platform) {
    case 'win32':
      return checkWindowsAvailability();

    case 'linux':
      try {
        const { stdout } = await execAsync('id -u', { timeout: 2000 });
        if (stdout.trim() === '0') {
          return { available: true };
        }
        try {
          await execAsync('capsh --print 2>/dev/null | grep -q "cap_sys_ptrace"', { timeout: 2000 });
          return { available: true };
        } catch {
          return {
            available: false,
            reason: 'Linux memory operations require root privileges or CAP_SYS_PTRACE capability. Run with sudo.',
          };
        }
      } catch {
        return { available: false, reason: 'Requires root privileges for /proc/pid/mem access. Run with sudo.' };
      }

    case 'darwin':
      try {
        await execAsync('which lldb', { timeout: 3000 });
        const isRoot = process.getuid?.() === 0;
        return {
          available: true,
          reason: isRoot
            ? undefined
            : 'Running without root — memory access works for own processes only. Use sudo for other processes.',
        };
      } catch {
        return {
          available: false,
          reason: 'lldb not found. Install Xcode Command Line Tools: xcode-select --install',
        };
      }

    default:
      return { available: false, reason: `Platform ${platform} not supported for memory operations.` };
  }
}

/** For Windows debug-port check (inline PowerShell, no shared state) */
export async function checkDebugPort(
  platform: Platform,
  pid: number
): Promise<{ success: boolean; isDebugged?: boolean; error?: string }> {
  if (platform !== 'win32') {
    return { success: false, error: 'Debug port check currently only implemented for Windows' };
  }

  try {
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class DebugChecker {
    [DllImport("ntdll.dll")]
    public static extern int NtQueryInformationProcess(IntPtr processHandle, int processInformationClass, out IntPtr processInformation, int processInformationLength, out int returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int ProcessDebugPort = 7;

    public static object Check(int pid) {
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process");
        }

        try {
            IntPtr debugPort;
            int returnLength;
            int status = NtQueryInformationProcess(hProcess, ProcessDebugPort, out debugPort, IntPtr.Size, out returnLength);

            if (status != 0) {
                return new { success = false, error = "NtQueryInformationProcess failed with status: 0x" + status.ToString("X") };
            }

            return new { success = true, isDebugged = debugPort != IntPtr.Zero };
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [DebugChecker]::Check(${pid})
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
    `;

    const { stdout } = await executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 10000 });

    const _trimmed = stdout.trim();
    if (!_trimmed) throw new Error('PowerShell returned empty output');
    return JSON.parse(_trimmed);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PowerShell execution failed',
    };
  }
}
