import { isKoffiAvailable, isWindows } from '@native/Win32API';

export async function checkNativeMemoryAvailability(
  execAsync: (
    command: string,
    options?: { timeout?: number }
  ) => Promise<{ stdout: string; stderr: string }>
): Promise<{ available: boolean; reason?: string }> {
  // ── macOS (Darwin) path ──
  if (process.platform === 'darwin') {
    return checkDarwinAvailability(execAsync);
  }

  // ── Windows path ──
  if (!isWindows()) {
    return {
      available: false,
      reason: `Native memory operations require Windows or macOS. Current platform: ${process.platform}`,
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

// ── macOS-specific checks ──

async function checkDarwinAvailability(
  execAsync: (
    command: string,
    options?: { timeout?: number }
  ) => Promise<{ stdout: string; stderr: string }>
): Promise<{ available: boolean; reason?: string }> {
  // 1. Check koffi + libSystem.B.dylib availability
  try {
    // Dynamic import to avoid loading koffi bindings on Windows
    const koffiMod = await import('koffi');
    const testLib = koffiMod.default.load('/usr/lib/libSystem.B.dylib');
    testLib.unload();
  } catch {
    return {
      available: false,
      reason: 'koffi library cannot load libSystem.B.dylib. Install koffi with: pnpm add koffi',
    };
  }

  // 2. Check SIP status (informational — not blocking)
  let sipInfo = '';
  try {
    const { stdout } = await execAsync('csrutil status 2>&1 || true', { timeout: 5000 });
    sipInfo = stdout.trim();
  } catch {
    // SIP check is informational only
  }

  // 3. Check root privileges (required for task_for_pid on foreign processes)
  if (process.getuid && process.getuid() !== 0) {
    const sipNote = sipInfo ? ` SIP status: ${sipInfo}` : '';
    return {
      available: false,
      reason: `macOS memory operations require root privileges for task_for_pid. Run with: sudo node <your-script>.${sipNote}`,
    };
  }

  return { available: true };
}

