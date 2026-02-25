/**
 * macOS Process Manager - Utilities for process enumeration, window management,
 * and process attachment for debugging purposes.
 *
 * Supports: Chrome/Chromium, general macOS processes
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';
import { ProcessInfo, WindowInfo } from './ProcessManager.js';

const execAsync = promisify(exec);

export interface ChromeProcess {
  mainProcess?: ProcessInfo;
  rendererProcesses: ProcessInfo[];
  gpuProcess?: ProcessInfo;
  utilityProcesses: ProcessInfo[];
  targetWindow?: WindowInfo;
}

/**
 * macOS Process Manager
 * Provides utilities for:
 * - Enumerating processes by name/pattern
 * - Finding window IDs (AppleScript/CoreGraphics)
 * - Attaching debuggers to processes
 * - Process lifecycle management
 */
export class MacProcessManager {
  constructor() {
    logger.info('MacProcessManager initialized');
  }

  /**
   * Enumerate all processes matching a pattern
   */
  async findProcesses(pattern: string): Promise<ProcessInfo[]> {
    try {
      // Use ps command for process enumeration
      const { stdout } = await execAsync(
        `ps aux | grep -i "${pattern}" | grep -v grep || true`,
        { maxBuffer: 1024 * 1024 * 10 }
      );

      const processes: ProcessInfo[] = [];
      const lines = stdout.trim().split('\n').filter(line => line.trim());

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1] || '0', 10);
          if (isNaN(pid)) continue; // skip header line
          const cpu = parseFloat(parts[2] || '0');
          const mem = parseFloat(parts[3] || '0');
          const command = parts.slice(10).join(' ');

          processes.push({
            pid,
            name: parts[10] || command.split(' ')[0] || 'unknown',
            commandLine: command,
            cpuUsage: cpu,
            memoryUsage: mem * 1024 * 1024, // Approximate bytes
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
      // Use ps with specific PID
      const { stdout } = await execAsync(
        `ps -p ${pid} -o pid,ppid,pcpu,pmem,comm,args 2>/dev/null || echo ""`
      );

      const lines = stdout.trim().split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        return null;
      }

      const dataLine = lines[1] || '';
      const parts = dataLine.trim().split(/\s+/);

      if (parts.length >= 6) {
        return {
          pid: parseInt(parts[0] || '0', 10),
          parentPid: parseInt(parts[1] || '0', 10),
          name: parts[4] || 'unknown',
          executablePath: await this.getProcessPath(pid),
          commandLine: parts.slice(5).join(' '),
          cpuUsage: parseFloat(parts[2] || '0'),
          memoryUsage: parseFloat(parts[3] || '0') * 1024 * 1024,
        };
      }

      return null;
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
      const { stdout } = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null || echo ""`);
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get all windows for a process using AppleScript
   */
  async getProcessWindows(pid: number): Promise<WindowInfo[]> {
    try {
      // Get process name first
      const process = await this.getProcessByPid(pid);
      if (!process) {
        return [];
      }

      // Use AppleScript to get window information
      const appleScript = `
        tell application "System Events"
          set processList to {}
          try
            set targetProcess to first process whose unix id is ${pid}
            set procName to name of targetProcess
            set windowList to {}

            tell targetProcess
              repeat with win in windows
                set winInfo to {|
                  title:name of win,
                  className:procName,
                  processId:${pid},
                  handle:"applescript-window"
                |}
                set end of windowList to winInfo
              end repeat
            end tell

            return windowList
          on error
            return {}
          end try
        end tell
      `;

      const { stdout } = await execAsync(
        `osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}' 2>/dev/null || echo "[]"`,
        { timeout: 5000 }
      );

      // Parse AppleScript output
      const windows: WindowInfo[] = [];

      // AppleScript returns a list format, parse it
      if (stdout.trim() && stdout.trim() !== '[]') {
        // Simple parsing for window titles
        const titles = stdout.match(/title:([^,}]+)/g);
        if (titles) {
          for (const title of titles) {
            const cleanTitle = title.replace('title:', '').trim();
            windows.push({
              handle: `mac-window-${pid}`,
              title: cleanTitle,
              className: process.name,
              processId: pid,
              threadId: 0,
            });
          }
        }
      }

      return windows;
    } catch (error) {
      logger.error(`Failed to get windows for PID ${pid}:`, error);
      return [];
    }
  }

  /**
   * Alternative: Use CoreGraphics via a simple Python script
   * This provides more detailed window information
   */
  async getProcessWindowsCG(pid: number): Promise<WindowInfo[]> {
    try {
      const pythonScript = `
import Quartz
import sys

window_list = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionAll,
    Quartz.kCGNullWindowID
)

result = []
for window in window_list:
    if window.get('kCGWindowOwnerPID') == ${pid}:
        result.append({
            'handle': str(window.get('kCGWindowNumber', 0)),
            'title': window.get('kCGWindowName', ''),
            'className': window.get('kCGWindowOwnerName', ''),
            'processId': ${pid},
            'bounds': window.get('kCGWindowBounds', {})
        })

print(result)
`;

      const { stdout } = await execAsync(
        `python3 -c "${pythonScript.replace(/"/g, '\\"')}" 2>/dev/null || echo "[]"`
      );

      const windows: WindowInfo[] = [];

      try {
        const data = JSON.parse(stdout.trim().replace(/'/g, '"'));
        for (const win of data) {
          windows.push({
            handle: win.handle,
            title: win.title,
            className: win.className,
            processId: win.processId,
            threadId: 0,
            bounds: win.bounds ? {
              x: win.bounds.X || 0,
              y: win.bounds.Y || 0,
              width: win.bounds.Width || 0,
              height: win.bounds.Height || 0,
            } : undefined,
          });
        }
      } catch {
        // JSON parse failed, return empty
      }

      return windows;
    } catch (error) {
      logger.error(`Failed to get windows via CoreGraphics for PID ${pid}:`, error);
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
      if (result.mainProcess) {
        const windows = await this.getProcessWindowsCG(result.mainProcess.pid);
        if (windows.length > 0) {
          result.targetWindow = windows[0];
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
      const { stdout } = await execAsync(
        `ps -p ${pid} -o ppid=,args= 2>/dev/null || echo ""`
      );

      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 2) {
        return {
          parentPid: parseInt(parts[0] || '0', 10),
          commandLine: parts.slice(1).join(' ') || undefined,
        };
      }

      return {};
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
      // Check for --remote-debugging-port in command line
      const { commandLine } = await this.getProcessCommandLine(pid);

      if (commandLine) {
        const match = commandLine.match(/--remote-debugging-port=(\d+)/);
        if (match && match[1]) {
          return parseInt(match[1], 10);
        }
      }

      // Check listening ports using lsof
      const { stdout } = await execAsync(
        `lsof -Pan -p ${pid} -i 2>/dev/null | grep LISTEN || true`,
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
      await execAsync(`kill -9 ${pid} 2>/dev/null || kill -15 ${pid}`);
      logger.info(`Process ${pid} killed successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to kill process ${pid}:`, error);
      return false;
    }
  }
}
