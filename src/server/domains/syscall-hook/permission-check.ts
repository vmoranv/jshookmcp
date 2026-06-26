export interface PermissionCheckResult {
  hasPermission: boolean;
  platform: string;
  reason?: string;
  requiredCapabilities?: string[];
}

export async function checkSyscallPermission(): Promise<PermissionCheckResult> {
  const platform = process.platform;

  if (platform === 'linux') {
    // Check: process.geteuid?.() === 0 OR ptrace_scope == 0
    // On Linux, strace needs either root or ptrace_scope=0
    try {
      if (process.geteuid?.() === 0) return { hasPermission: true, platform };
      const { readFileSync } = await import('node:fs');
      const ptraceScope = readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim();
      if (ptraceScope === '0') return { hasPermission: true, platform };
      return {
        hasPermission: false,
        platform,
        reason: 'strace requires root (EUID=0) or ptrace_scope=0',
        requiredCapabilities: ['root', 'CAP_SYS_PTRACE'],
      };
    } catch {
      return { hasPermission: true, platform }; // If can't check, allow (will fail at runtime)
    }
  }

  if (platform === 'win32') {
    // ETW requires Administrator or Performance Monitor Users group
    // We can't reliably check without native APIs, so attempt a lightweight probe
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      await execFileAsync('logman', ['query', 'providers'], { timeout: 5000 });
      return { hasPermission: true, platform };
    } catch {
      return {
        hasPermission: false,
        platform,
        reason: 'ETW trace requires Administrator privileges',
        requiredCapabilities: ['Administrator'],
      };
    }
  }

  if (platform === 'darwin') {
    // dtrace requires root or specific entitlements
    try {
      if (process.geteuid?.() === 0) return { hasPermission: true, platform };
      return {
        hasPermission: false,
        platform,
        reason: 'dtrace requires root privileges on macOS',
        requiredCapabilities: ['root'],
      };
    } catch {
      return { hasPermission: true, platform };
    }
  }

  return { hasPermission: true, platform };
}
