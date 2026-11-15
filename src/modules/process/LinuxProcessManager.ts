/**
 * Linux Process Manager - Utilities for process enumeration, window management,
 * and process attachment for debugging purposes.
 *
 * Supports: Chrome/Chromium, general Linux processes
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '@utils/logger';
import { DEFAULT_DEBUG_PORT } from '@src/constants';
import {
  checkDebugPortPosix,
  findChromeProcessesPosix,
  findProcessesPosix,
  launchWithDebugPosix,
} from '@modules/process/posix-debug-launch';
import type { ProcessInfo, WindowInfo } from '@modules/process/ProcessManager';

const execAsync = promisify(exec);

/** Strip shell metacharacters from a grep pattern to prevent command injection. */
/** Validate and normalize a PID value. Throws on invalid input. */
function safePid(pid: number): number {
  const n = Math.trunc(Number(pid));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid PID: ${pid}`);
  return n;
}

export interface ChromeProcess {
  mainProcess?: ProcessInfo;
  rendererProcesses: ProcessInfo[];
  gpuProcess?: ProcessInfo;
  utilityProcesses: ProcessInfo[];
  targetWindow?: WindowInfo;
}

/**
 * Linux Process Manager
 * Provides utilities for:
 * - Enumerating processes by name/pattern
 * - Finding window IDs (X11/Wayland)
 * - Attaching debuggers to processes
 * - Process lifecycle management
 */
export class LinuxProcessManager {
  private isWayland: boolean = false;

  constructor() {
    void this.detectDisplayServer();
    logger.info('LinuxProcessManager initialized', {
      displayServer: this.isWayland ? 'Wayland' : 'X11',
    });
  }

  private async detectDisplayServer(): Promise<void> {
    try {
      const { stdout } = await execAsync('echo $XDG_SESSION_TYPE');
      this.isWayland = stdout.trim() === 'wayland';
    } catch {
      this.isWayland = false;
    }
  }

  /**
   * Enumerate all processes matching a pattern
   */
  async findProcesses(pattern: string): Promise<ProcessInfo[]> {
    return findProcessesPosix(pattern, execAsync);
  }

  /**
   * Get process info by PID
   */
  async getProcessByPid(pid: number): Promise<ProcessInfo | null> {
    try {
      pid = safePid(pid);
      const { stdout } = await execAsync(`cat /proc/${pid}/status 2>/dev/null || echo ""`);
      const { stdout: cmdline } = await execAsync(
        `cat /proc/${pid}/cmdline 2>/dev/null | tr '\0' ' ' || echo ""`,
      );
      const { stdout: stat } = await execAsync(`cat /proc/${pid}/stat 2>/dev/null || echo ""`);

      if (!stdout.trim()) {
        return null;
      }

      const status: Record<string, string> = {};
      for (const line of stdout.split('\n')) {
        const [key, value] = line.split(':');
        if (key && value) {
          status[key.trim()] = value.trim();
        }
      }

      const statParts = stat.trim().split(' ');
      const utime = statParts.length > 13 ? parseInt(statParts[13] || '0', 10) : 0;
      const stime = statParts.length > 14 ? parseInt(statParts[14] || '0', 10) : 0;

      return {
        pid,
        name: status['Name'] || 'unknown',
        executablePath: await this.getProcessPath(pid),
        commandLine: cmdline.trim() || undefined,
        parentPid: status['PPid'] ? parseInt(status['PPid'], 10) : undefined,
        memoryUsage: status['VmRSS']
          ? parseInt(status['VmRSS'].replace(/\D/g, ''), 10) * 1024
          : undefined,
        cpuUsage: utime + stime,
      };
    } catch (error) {
      logger.error(`Failed to get process by PID ${pid}:`, error);
      return null;
    }
  }

  /**
   * Get executable path for a process
   */
  private async getProcessPath(pid: number): Promise<string | undefined> {
    try {
      pid = safePid(pid);
      const { stdout } = await execAsync(`readlink -f /proc/${pid}/exe 2>/dev/null || echo ""`);
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get all windows for a process (X11 only)
   */
  async getProcessWindows(pid: number): Promise<WindowInfo[]> {
    const windows: WindowInfo[] = [];

    try {
      pid = safePid(pid);

      if (this.isWayland) {
        logger.debug('Attempting Wayland window enumeration via compositor-specific APIs');

        // 1. Try Hyprland
        try {
          const { stdout: hyprctlOut } = await execAsync('hyprctl clients -j 2>/dev/null');
          if (hyprctlOut.trim()) {
            const clients = JSON.parse(hyprctlOut);
            for (const client of clients) {
              if (client.pid === pid) {
                windows.push({
                  handle: client.address || client.window || '0',
                  title: client.title || '',
                  className: client.class || '',
                  processId: pid,
                  threadId: 0,
                });
              }
            }
            if (windows.length > 0) return windows;
          }
        } catch {
          // Ignore hyprctl failures
        }

        // 2. GNOME Wayland: org.gnome.Shell.Eval is disabled by default since GNOME 42.
        // Keeping as best-effort; no window data is parsed from this path.
        try {
          const { stdout: gnomeOut } = await execAsync(
            `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval` +
              ` "global.get_window_actors().filter(w => w.meta_window.get_pid() === ${pid}).map(w => ` +
              `w.meta_window.get_title() + '|' + w.meta_window.get_wm_class())" 2>/dev/null`,
          );
          if (gnomeOut.includes(String(pid)) || gnomeOut.includes(',')) {
            logger.debug(
              'GNOME Wayland window query returned data, but reliable parsing is not yet implemented',
            );
          }
        } catch {
          // Expected: gdbus Eval is restricted on most GNOME ≥42 installs
        }
      }

      // Fallback to X11 / XWayland
      const { stdout: xdotoolCheck } = await execAsync('which xdotool 2>/dev/null || echo ""');
      if (!xdotoolCheck.trim()) {
        if (this.isWayland && windows.length === 0) {
          logger.warn(
            'Wayland native enumeration failed and xdotool is missing. Install xdotool for XWayland fallback.',
          );
        } else if (!this.isWayland) {
          logger.warn(
            'xdotool not found. Install it for window management: sudo apt-get install xdotool',
          );
        }
        return windows;
      }

      const { stdout } = await execAsync(`xdotool search --all --pid ${pid} 2>/dev/null || true`);
      const windowIds = stdout
        .trim()
        .split('\n')
        .filter((id) => id.trim());

      for (const windowId of windowIds) {
        try {
          const { stdout: title } = await execAsync(
            `xdotool getwindowname ${windowId} 2>/dev/null || echo ""`,
          );
          const { stdout: className } = await execAsync(
            `xdotool getwindowclassname ${windowId} 2>/dev/null || echo ""`,
          );

          windows.push({
            handle: windowId,
            title: title.trim(),
            className: className.trim(),
            processId: pid,
            threadId: 0,
          });
        } catch {
          // Skip windows that can't be queried
        }
      }

      return windows;
    } catch (error) {
      logger.error(`Failed to get windows for PID ${pid}:`, error);
      return windows;
    }
  }

  /**
   * Find Chrome/Chromium processes
   */
  async findChromeProcesses(): Promise<ChromeProcess> {
    // Shared enumeration/classification; platform-specific target-window pick.
    const result = await findChromeProcessesPosix(
      (pattern) => this.findProcesses(pattern),
      (pid) => this.getProcessByPid(pid),
    );
    // Find target window: scan the main process plus renderers for a
    // Chrome/Chromium titled window. Window enumeration is best-effort —
    // a failure here must not lose the classified process list.
    try {
      const allPids = [
        result.mainProcess?.pid,
        ...result.rendererProcesses.map((p) => p.pid),
      ].filter(Boolean) as number[];

      for (const pid of allPids) {
        const windows = await this.getProcessWindows(pid);
        const targetWindow = windows.find(
          (w) =>
            w.title.includes('Chrome') ||
            w.className.includes('Chrome') ||
            w.title.includes('Chromium'),
        );

        if (targetWindow) {
          result.targetWindow = targetWindow;
          break;
        }
      }
    } catch (error) {
      logger.error('Failed to resolve Chrome target window:', error);
    }
    logger.info('Chrome processes found:', {
      main: result.mainProcess?.pid,
      renderers: result.rendererProcesses.length,
      hasTargetWindow: !!result.targetWindow,
    });

    return result;
  }

  /**
   * Get process command line arguments
   */
  async getProcessCommandLine(
    pid: number,
  ): Promise<{ commandLine?: string; parentPid?: number; name?: string }> {
    try {
      pid = safePid(pid);
      const { stdout: cmdline } = await execAsync(
        `cat /proc/${pid}/cmdline 2>/dev/null | tr '\0' ' ' || echo ""`,
      );
      const { stdout: status } = await execAsync(
        `cat /proc/${pid}/status 2>/dev/null | grep PPid || echo ""`,
      );

      const ppidMatch = status.match(/PPid:\s*(\d+)/);
      // argv[0] basename serves as the PID-reuse identity, consistent with
      // getProcessByPid's /proc/status Name after normalization.
      const argv0 = (cmdline.trim().split(' ')[0] || '').split('/').pop();

      return {
        commandLine: cmdline.trim() || undefined,
        parentPid: ppidMatch?.[1] ? parseInt(ppidMatch[1], 10) : undefined,
        name: argv0 || undefined,
      };
    } catch (error) {
      logger.error(`Failed to get command line for PID ${pid}:`, error);
      return {};
    }
  }

  /**
   * Check if a process has a debug port enabled
   */
  async checkDebugPort(pid: number, options?: { commandLine?: string }): Promise<number | null> {
    return checkDebugPortPosix(
      pid,
      `ss -tlnp 2>/dev/null | grep "pid=${pid}" || netstat -tlnp 2>/dev/null | grep "${pid}" || true`,
      safePid,
      execAsync,
      async (p) => {
        const { commandLine } = await this.getProcessCommandLine(p);
        return commandLine;
      },
      options,
    );
  }

  /**
   * Launch process with debugging enabled.
   * Shared POSIX implementation (see posix-debug-launch.ts) — the two platform
   * managers only differ in how they resolve a PID to ProcessInfo.
   */
  async launchWithDebug(
    executablePath: string,
    debugPort: number = DEFAULT_DEBUG_PORT,
    args: string[] = [],
  ): Promise<ProcessInfo | null> {
    return launchWithDebugPosix(
      executablePath,
      (pid) => this.getProcessByPid(pid),
      debugPort,
      args,
    );
  }

  /**
   * Kill a process by PID
   */
  async killProcess(pid: number): Promise<boolean> {
    try {
      pid = safePid(pid);
      await execAsync(`kill -9 ${pid} 2>/dev/null || kill -15 ${pid}`);
      logger.info(`Process ${pid} killed successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to kill process ${pid}:`, error);
      return false;
    }
  }

  /**
   * Check if running on Wayland
   */
  isRunningOnWayland(): boolean {
    return this.isWayland;
  }
}
