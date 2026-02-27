/**
 * Linux Process Manager - Utilities for process enumeration, window management,
 * and process attachment for debugging purposes.
 *
 * Supports: Chrome/Chromium, general Linux processes
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';
import { ProcessInfo, WindowInfo } from './ProcessManager.js';

const execAsync = promisify(exec);

/** Strip shell metacharacters from a grep pattern to prevent command injection. */
function sanitizePattern(s: string): string {
  return String(s || '').replace(/[^\w\s.@/\-:,+]/g, '');
}

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
    this.detectDisplayServer();
    logger.info('LinuxProcessManager initialized', { displayServer: this.isWayland ? 'Wayland' : 'X11' });
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
    try {
      const safePattern = sanitizePattern(pattern);
      const { stdout } = await execAsync(
        `ps aux | grep -i "${safePattern}" | grep -v grep || true`,
        { maxBuffer: 1024 * 1024 * 10 }
      );

      const processes: ProcessInfo[] = [];
      const lines = stdout.trim().split('\n').filter(line => line.trim());

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1] || '0', 10);
          const cpu = parseFloat(parts[2] || '0');
          const mem = parseFloat(parts[3] || '0');
          const command = parts.slice(10).join(' ');

          processes.push({
            pid,
            name: parts[10] || command.split(' ')[0] || 'unknown',
            commandLine: command,
            cpuUsage: cpu,
            memoryUsage: mem * 1024 * 1024, // Convert percentage to approximate bytes
          });
        }
      }

      logger.info(`Found ${processes.length} processes matching '${pattern}'`);
      return processes;
    } catch (error) {
      logger.error(`Failed to find processes with pattern '${pattern}':`, error);
      return [];
    }
  }

  /**
   * Get process info by PID
   */
  async getProcessByPid(pid: number): Promise<ProcessInfo | null> {
    try {
      pid = safePid(pid);
      // Read from /proc filesystem
      const { stdout } = await execAsync(`cat /proc/${pid}/status 2>/dev/null || echo ""`);
      const { stdout: cmdline } = await execAsync(`cat /proc/${pid}/cmdline 2>/dev/null | tr '\0' ' ' || echo ""`);
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

      // Parse stat file for CPU info
      const statParts = stat.trim().split(' ');
      const utime = statParts.length > 13 ? parseInt(statParts[13] || '0', 10) : 0;
      const stime = statParts.length > 14 ? parseInt(statParts[14] || '0', 10) : 0;

      return {
        pid,
        name: status['Name'] || 'unknown',
        executablePath: await this.getProcessPath(pid),
        commandLine: cmdline.trim() || undefined,
        parentPid: status['PPid'] ? parseInt(status['PPid'], 10) : undefined,
        memoryUsage: status['VmRSS'] ? parseInt(status['VmRSS'].replace(/\D/g, ''), 10) * 1024 : undefined,
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
    if (this.isWayland) {
      logger.warn('Window enumeration on Wayland is limited. Consider using X11 or xdotool.');
      return [];
    }

    try {
      pid = safePid(pid);
      // Check if xdotool is available
      const { stdout: xdotoolCheck } = await execAsync('which xdotool 2>/dev/null || echo ""');
      if (!xdotoolCheck.trim()) {
        logger.warn('xdotool not found. Install it for window management: sudo apt-get install xdotool');
        return [];
      }

      // Search for windows by PID
      const { stdout } = await execAsync(
        `xdotool search --all --pid ${pid} 2>/dev/null || true`
      );

      const windows: WindowInfo[] = [];
      const windowIds = stdout.trim().split('\n').filter(id => id.trim());

      for (const windowId of windowIds) {
        try {
          const { stdout: title } = await execAsync(
            `xdotool getwindowname ${windowId} 2>/dev/null || echo ""`
          );
          const { stdout: className } = await execAsync(
            `xdotool getwindowclassname ${windowId} 2>/dev/null || echo ""`
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
      return [];
    }
  }

  /**
   * Find Chrome/Chromium processes
   */
  async findChromeProcesses(): Promise<ChromeProcess> {
    const result: ChromeProcess = {
      rendererProcesses: [],
      utilityProcesses: [],
    };

    try {
      // Find all chrome/chromium processes
      const processes = await this.findProcesses('chrome');

      for (const proc of processes) {
        const detailedInfo = await this.getProcessByPid(proc.pid);

        if (detailedInfo?.commandLine) {
          const cmd = detailedInfo.commandLine.toLowerCase();

          if (cmd.includes('--type=renderer')) {
            result.rendererProcesses.push({ ...proc, ...detailedInfo });
          } else if (cmd.includes('--type=gpu-process')) {
            result.gpuProcess = { ...proc, ...detailedInfo };
          } else if (cmd.includes('--type=utility')) {
            result.utilityProcesses.push({ ...proc, ...detailedInfo });
          } else if (!cmd.includes('--type=')) {
            result.mainProcess = { ...proc, ...detailedInfo };
          }
        } else {
          if (!result.mainProcess) {
            result.mainProcess = proc;
          }
        }
      }

      // Find target window
      const allPids = [
        result.mainProcess?.pid,
        ...result.rendererProcesses.map(p => p.pid),
      ].filter(Boolean) as number[];

      for (const pid of allPids) {
        const windows = await this.getProcessWindows(pid);
        const targetWindow = windows.find(w =>
          w.title.includes('Chrome') ||
          w.className.includes('Chrome') ||
          w.title.includes('Chromium')
        );

        if (targetWindow) {
          result.targetWindow = targetWindow;
          break;
        }
      }

      logger.info('Chrome processes found:', {
        main: result.mainProcess?.pid,
        renderers: result.rendererProcesses.length,
        hasTargetWindow: !!result.targetWindow,
      });

      return result;
    } catch (error) {
      logger.error('Failed to find Chrome processes:', error);
      return result;
    }
  }

  /**
   * Get process command line arguments
   */
  async getProcessCommandLine(pid: number): Promise<{ commandLine?: string; parentPid?: number }> {
    try {
      pid = safePid(pid);
      const { stdout: cmdline } = await execAsync(
        `cat /proc/${pid}/cmdline 2>/dev/null | tr '\0' ' ' || echo ""`
      );
      const { stdout: status } = await execAsync(
        `cat /proc/${pid}/status 2>/dev/null | grep PPid || echo ""`
      );

      const ppidMatch = status.match(/PPid:\s*(\d+)/);

      return {
        commandLine: cmdline.trim() || undefined,
        parentPid: ppidMatch && ppidMatch[1] ? parseInt(ppidMatch[1], 10) : undefined,
      };
    } catch (error) {
      logger.error(`Failed to get command line for PID ${pid}:`, error);
      return {};
    }
  }

  /**
   * Check if a process has a debug port enabled
   */
  async checkDebugPort(pid: number): Promise<number | null> {
    try {
      pid = safePid(pid);
      // Check for --remote-debugging-port in command line
      const { commandLine } = await this.getProcessCommandLine(pid);

      if (commandLine) {
        const match = commandLine.match(/--remote-debugging-port=(\d+)/);
        if (match && match[1]) {
          return parseInt(match[1], 10);
        }
      }

      // Check listening ports for the process
      const { stdout } = await execAsync(
        `ss -tlnp 2>/dev/null | grep "pid=${pid}" || netstat -tlnp 2>/dev/null | grep "${pid}" || true`,
        { maxBuffer: 1024 * 1024 }
      );

      // Common debug ports
      const debugPorts = [9222, 9229, 9333, 2039];
      for (const port of debugPorts) {
        if (stdout.includes(`:${port}`)) {
          return port;
        }
      }

      return null;
    } catch (error) {
      logger.error(`Failed to check debug port for PID ${pid}:`, error);
      return null;
    }
  }

  /**
   * Launch process with debugging enabled
   */
  async launchWithDebug(
    executablePath: string,
    debugPort: number = 9222,
    args: string[] = []
  ): Promise<ProcessInfo | null> {
    try {
      const debugArgs = [`--remote-debugging-port=${debugPort}`, ...args];

      const child = spawn(executablePath, debugArgs, {
        detached: true,
        stdio: 'ignore',
      });

      child.unref();

      // Wait for process to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      const process = await this.getProcessByPid(child.pid || 0);

      logger.info(`Launched process with debug port ${debugPort}:`, {
        pid: child.pid,
        executable: executablePath,
      });

      return process;
    } catch (error) {
      logger.error('Failed to launch process with debug:', error);
      return null;
    }
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
