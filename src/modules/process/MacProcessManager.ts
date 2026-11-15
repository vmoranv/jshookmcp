/**
 * macOS Process Manager - Utilities for process enumeration, window management,
 * and process attachment for debugging purposes.
 *
 * Supports: Chrome/Chromium, general macOS processes
 */

import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '@utils/logger';
import {
  DEFAULT_DEBUG_PORT,
  EXTERNAL_TOOL_PROBE_TIMEOUT_MS,
  NATIVE_ADMIN_CHECK_TIMEOUT_MS,
} from '@src/constants';
import { ScriptLoader } from '@native/ScriptLoader';
import {
  checkDebugPortPosix,
  findChromeProcessesPosix,
  findProcessesPosix,
  launchWithDebugPosix,
} from '@modules/process/posix-debug-launch';
import type { ProcessInfo, WindowInfo } from '@modules/process/ProcessManager';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Strip shell metacharacters from a grep pattern to prevent command injection. */
/** Validate and normalize a PID value. Throws on invalid input. */
function safePid(pid: number): number {
  const n = Math.trunc(Number(pid));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid PID: ${pid}`);
  return n;
}

function renderScriptTemplate(
  template: string,
  placeholders: Record<string, string | number>,
): string {
  let output = template;
  for (const [key, value] of Object.entries(placeholders)) {
    const marker = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    output = output.replace(marker, String(value));
  }
  return output;
}

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
    return findProcessesPosix(pattern, execAsync);
  }

  /**
   * Get process info by PID
   */
  async getProcessByPid(pid: number): Promise<ProcessInfo | null> {
    try {
      pid = safePid(pid);
      const { stdout } = await execAsync(
        `ps -p ${pid} -o pid,ppid,pcpu,pmem,comm,args 2>/dev/null || echo ""`,
      );

      const lines = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim());
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
      pid = safePid(pid);
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
      pid = safePid(pid);
      const process = await this.getProcessByPid(pid);
      if (!process) {
        return [];
      }

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
        { timeout: EXTERNAL_TOOL_PROBE_TIMEOUT_MS },
      );

      const windows: WindowInfo[] = [];

      if (stdout.trim() && stdout.trim() !== '[]') {
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
      pid = safePid(pid);
      const loader = new ScriptLoader();
      const pythonTemplate = await loader.loadScript('process_list.py');
      const pythonScript = renderScriptTemplate(pythonTemplate, {
        PID: pid,
      });

      const { stdout } = await execFileAsync('python3', ['-c', pythonScript], {
        timeout: NATIVE_ADMIN_CHECK_TIMEOUT_MS * 2,
        windowsHide: true,
      });

      const windows: WindowInfo[] = [];

      try {
        const data = JSON.parse(stdout.trim());
        for (const win of data) {
          windows.push({
            handle: win.handle,
            title: win.title,
            className: win.className,
            processId: win.processId,
            threadId: 0,
            bounds: win.bounds
              ? {
                  x: win.bounds.X || 0,
                  y: win.bounds.Y || 0,
                  width: win.bounds.Width || 0,
                  height: win.bounds.Height || 0,
                }
              : undefined,
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
    // Shared enumeration/classification; platform-specific target-window pick.
    const result = await findChromeProcessesPosix(
      (pattern) => this.findProcesses(pattern),
      (pid) => this.getProcessByPid(pid),
    );
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
  }

  /**
   * Get process command line arguments
   */
  async getProcessCommandLine(
    pid: number,
  ): Promise<{ commandLine?: string; parentPid?: number; name?: string }> {
    try {
      pid = safePid(pid);
      const { stdout } = await execAsync(`ps -p ${pid} -o ppid=,args= 2>/dev/null || echo ""`);

      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 2) {
        // argv[0] basename matches getProcessByPid's `comm` name closely
        // enough for a PID-reuse identity check after normalization.
        const argv0 = parts[1] || '';
        return {
          parentPid: parseInt(parts[0] || '0', 10),
          commandLine: parts.slice(1).join(' ') || undefined,
          name: argv0.split('/').pop() || undefined,
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
  async checkDebugPort(pid: number, options?: { commandLine?: string }): Promise<number | null> {
    return checkDebugPortPosix(
      pid,
      `lsof -Pan -p ${pid} -i 2>/dev/null | grep LISTEN || true`,
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
}
