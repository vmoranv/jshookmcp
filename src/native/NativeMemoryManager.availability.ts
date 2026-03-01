import { isKoffiAvailable, isWindows } from './Win32API.js';

export async function checkNativeMemoryAvailability(
  execAsync: (command: string, options?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }>
): Promise<{ available: boolean; reason?: string }> {
  if (!isWindows()) {
    return {
      available: false,
      reason: `Native memory operations only supported on Windows. Current platform: ${process.platform}`,
    };
  }

  if (!isKoffiAvailable()) {
    return {
      available: false,
      reason: 'koffi library not available. Install with: pnpm add koffi',
    };
  }

  // Check admin privileges
  try {
    const { stdout } = await execAsync(
      'powershell.exe -NoProfile -Command "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"',
      { timeout: 5000 }
    );

    if (stdout.trim().toLowerCase() !== 'true') {
      return {
        available: false,
        reason: 'Native memory operations require Administrator privileges. Run as Administrator.',
      };
    }
  } catch {
    return {
      available: false,
      reason: 'Failed to check Administrator privileges.',
    };
  }

  return { available: true };
}
