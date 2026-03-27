/**
 * Memory Scanner — thin facade re-exporting platform-specific implementations.
 *
 * Platform scan logic lives in:
 *  - scanner.patterns.ts  (shared pattern parsing)
 *  - scanner.windows.ts   (koffi native + PowerShell fallback)
 *  - scanner.linux.ts     (/proc/[pid]/mem direct read)
 *  - scanner.darwin.ts    (native Mach API + lldb fallback)
 *
 * @param suspendTarget - When true, the target process is paused during
 *   scanning for a consistent memory snapshot. Uses:
 *   - macOS: task_suspend / task_resume (Mach API)
 *   - Linux: SIGSTOP / SIGCONT
 *   - Windows: NtSuspendProcess / NtResumeProcess
 */
import { logger } from '@utils/logger';
import type { Platform, MemoryScanResult, PatternType } from '@modules/process/memory/types';
import { scanMemoryWindows } from './scanner.windows';
import { scanMemoryLinux } from './scanner.linux';
import { scanMemoryMac } from './scanner.darwin';

// Re-export pattern helpers for external consumers
export { buildPatternBytesAndMask, patternToBytesMac } from './scanner.patterns';

export interface ScanOptions {
  patternType?: PatternType;
  /** Suspend the target process during scan for a consistent memory snapshot. */
  suspendTarget?: boolean;
}

export async function scanMemory(
  platform: Platform,
  pid: number,
  pattern: string,
  patternType: PatternType = 'hex',
  suspendTarget = false,
): Promise<MemoryScanResult> {
  let suspended = false;

  try {
    if (suspendTarget) {
      suspended = await suspendProcess(platform, pid);
      if (suspended) {
        logger.info(`Suspended process ${pid} for consistent memory scan`);
      } else {
        logger.warn(`Could not suspend process ${pid} — scanning unsuspended`);
      }
    }

    switch (platform) {
      case 'win32':
        return await scanMemoryWindows(pid, pattern, patternType);
      case 'linux':
        return await scanMemoryLinux(pid, pattern, patternType);
      case 'darwin':
        return await scanMemoryMac(pid, pattern, patternType);
      default:
        return { success: false, addresses: [], error: `Memory scan not supported on ${platform}` };
    }
  } catch (error) {
    logger.error('Memory scan failed:', error);
    return {
      success: false,
      addresses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (suspended) {
      await resumeProcess(platform, pid);
      logger.info(`Resumed process ${pid} after memory scan`);
    }
  }
}

export async function scanMemoryFiltered(
  pid: number,
  pattern: string,
  addresses: string[],
  patternType: PatternType = 'hex',
  _readMemoryFn: (
    pid: number,
    address: string,
    size: number,
  ) => Promise<{ success: boolean; data?: string }>,
  scanMemoryFn: (
    pid: number,
    pattern: string,
    patternType: PatternType,
  ) => Promise<MemoryScanResult>,
): Promise<MemoryScanResult> {
  const validAddresses: number[] = [];
  for (const addr of addresses) {
    const num = parseInt(addr, 16);
    if (!isNaN(num)) validAddresses.push(num);
  }

  if (validAddresses.length === 0) {
    return { success: false, addresses: [], error: 'No valid addresses provided' };
  }

  const fullScan = await scanMemoryFn(pid, pattern, patternType);
  if (!fullScan.success || fullScan.addresses.length === 0) {
    return {
      success: true,
      addresses: [],
      stats: { resultsFound: 0, patternLength: pattern.length },
    };
  }

  const windowSize = 256;
  const results: string[] = [];

  for (const matchAddr of fullScan.addresses) {
    const matchNum = parseInt(matchAddr, 16);
    if (validAddresses.some((a) => Math.abs(a - matchNum) < windowSize)) {
      if (!results.includes(matchAddr)) {
        results.push(matchAddr);
      }
    }
  }

  return {
    success: true,
    addresses: results,
    stats: { resultsFound: results.length, patternLength: pattern.length },
  };
}

// ── Cross-platform process suspend/resume ──

async function suspendProcess(platform: Platform, pid: number): Promise<boolean> {
  try {
    switch (platform) {
      case 'darwin': {
        const { createPlatformProvider } = await import('@native/platform/factory.js');
        const provider = createPlatformProvider();
        const avail = await provider.checkAvailability();
        if (!avail.available) return false;
        const handle = provider.openProcess(pid, false);
        try {
          const { taskSuspend } = await import('@native/platform/darwin/DarwinAPI.js');
          const { machTaskSelf, taskForPid, KERN } =
            await import('@native/platform/darwin/DarwinAPI.js');
          const { kr, task } = taskForPid(machTaskSelf(), pid);
          if (kr !== KERN.SUCCESS) return false;
          const suspendKr = taskSuspend(task);
          return suspendKr === KERN.SUCCESS;
        } finally {
          provider.closeProcess(handle);
        }
      }
      case 'linux': {
        const { execAsync } = await import('@modules/process/memory/types');
        await execAsync(`kill -STOP ${pid}`, { timeout: 2000 });
        return true;
      }
      case 'win32': {
        const { execAsync } = await import('@modules/process/memory/types');
        // Windows: use PowerShell to call NtSuspendProcess
        await execAsync(
          `powershell -NoProfile -Command "(Add-Type -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);' -Name W -Namespace N -PassThru)::NtSuspendProcess((Get-Process -Id ${pid}).Handle)"`,
          { timeout: 5000 },
        );
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    logger.warn(`Failed to suspend process ${pid}:`, err);
    return false;
  }
}

async function resumeProcess(platform: Platform, pid: number): Promise<void> {
  try {
    switch (platform) {
      case 'darwin': {
        const { machTaskSelf, taskForPid, taskResume, KERN } =
          await import('@native/platform/darwin/DarwinAPI.js');
        const { kr, task } = taskForPid(machTaskSelf(), pid);
        if (kr === KERN.SUCCESS) taskResume(task);
        break;
      }
      case 'linux': {
        const { execAsync } = await import('@modules/process/memory/types');
        await execAsync(`kill -CONT ${pid}`, { timeout: 2000 });
        break;
      }
      case 'win32': {
        const { execAsync } = await import('@modules/process/memory/types');
        await execAsync(
          `powershell -NoProfile -Command "(Add-Type -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);' -Name W -Namespace N -PassThru)::NtResumeProcess((Get-Process -Id ${pid}).Handle)"`,
          { timeout: 5000 },
        );
        break;
      }
    }
  } catch (err) {
    logger.error(`CRITICAL: Failed to resume process ${pid} — may need manual SIGCONT:`, err);
  }
}
