/**
 * Windows Process Manager - Utilities for process enumeration, window handle management,
 * and process attachment for debugging purposes.
 *
 * Supports: Chromium-based applications, general Windows processes
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';
import { ScriptLoader } from '../../native/ScriptLoader.js';
import { BrowserDiscovery, BrowserInfo } from '../browser/BrowserDiscovery.js';

const execAsync = promisify(exec);

export interface ProcessInfo {
  pid: number;
  name: string;
  executablePath?: string;
  commandLine?: string;
  windowTitle?: string;
  windowHandle?: string;
  parentPid?: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface WindowInfo {
  handle: string;
  title: string;
  className: string;
  processId: number;
  threadId: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ChromiumProcess {
  mainProcess?: ProcessInfo;
  rendererProcesses: ProcessInfo[];
  gpuProcess?: ProcessInfo;
  utilityProcesses: ProcessInfo[];
  targetWindow?: WindowInfo;
}

/**
 * Configuration for target application discovery
 */
export interface TargetAppConfig {
  processNamePattern?: string | RegExp;
  windowTitlePattern?: string | RegExp;
  windowClassPattern?: string | RegExp;
}

/**
 * Default configuration for Chromium-based applications
 */
export const DEFAULT_CHROMIUM_CONFIG: TargetAppConfig = {
  processNamePattern: /^(chromium|chrome|msedge)$/i,
  windowClassPattern: 'Chrome_WidgetWin',
};

/**
 * Windows Process Manager
 * Provides utilities for:
 * - Enumerating processes by name/pattern
 * - Finding window handles
 * - Attaching debuggers to processes
 * - Memory operations (read/write)
 */
export class ProcessManager {
  private powershellPath: string = 'powershell.exe';
  private scriptLoader: ScriptLoader;
  private browserDiscovery: BrowserDiscovery;

  constructor() {
    this.scriptLoader = new ScriptLoader();
    this.browserDiscovery = new BrowserDiscovery();
    logger.info('ProcessManager initialized for Windows platform');
  }

  /**
   * Enumerate all processes matching a pattern
   */
  async findProcesses(pattern: string): Promise<ProcessInfo[]> {
    try {
      const normalizedPattern = String(pattern || '').trim();

      // Use direct PowerShell command instead of script embedding
      let psCommand: string;
      if (normalizedPattern) {
        psCommand = `Get-Process -Name "*${normalizedPattern.replace(/"/g, '""')}*" -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path, MainWindowTitle, MainWindowHandle, CPU, WorkingSet64 | ConvertTo-Json -Compress`;
      } else {
        psCommand = `Get-Process -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path, MainWindowTitle, MainWindowHandle, CPU, WorkingSet64 | ConvertTo-Json -Compress`;
      }

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: 1024 * 1024 * 10 }
      );

      const processes: ProcessInfo[] = [];
      const lines = stdout.trim();

      if (!lines || lines === 'null' || lines === '') {
        return processes;
      }

      const data = JSON.parse(lines);
      const procList = Array.isArray(data) ? data : [data];

      for (const proc of procList) {
        processes.push({
          pid: proc.Id,
          name: proc.ProcessName,
          executablePath: proc.Path,
        });
      }

      const patternStr = normalizedPattern.length > 0 ? `'${normalizedPattern}'` : 'all';
      logger.info(`Found ${processes.length} processes matching ${patternStr}`);
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
      const psCommand = `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path, MainWindowTitle, MainWindowHandle, CPU, WorkingSet64, StartTime | ConvertTo-Json -Compress`;

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: 1024 * 1024 }
      );

      if (!stdout.trim() || stdout.trim() === 'null') {
        return null;
      }

      const proc = JSON.parse(stdout.trim());
      return {
        pid: proc.Id,
        name: proc.ProcessName,
        executablePath: proc.Path,
        windowTitle: proc.MainWindowTitle,
        windowHandle: proc.MainWindowHandle?.toString(),
        cpuUsage: proc.CPU,
        memoryUsage: proc.WorkingSet64,
      };
    } catch (error) {
      logger.error(`Failed to get process by PID ${pid}:`, error);
      return null;
    }
  }

  /**
   * Get all windows for a process
   */
  async getProcessWindows(pid: number): Promise<WindowInfo[]> {
    try {
      // Load window enumeration script from external file
      const scriptPath = await this.scriptLoader.getScriptPath('enum-windows.ps1');

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -TargetPid ${pid}`,
        { maxBuffer: 1024 * 1024 }
      );

      if (!stdout.trim() || stdout.trim() === 'null') {
        return [];
      }

      const data = JSON.parse(stdout.trim());
      const windows: WindowInfo[] = [];
      const winList = Array.isArray(data) ? data : [data];

      for (const win of winList) {
        windows.push({
          handle: win.Handle,
          title: win.Title,
          className: win.ClassName,
          processId: win.ProcessId,
          threadId: 0, // Would need additional API call
        });
      }

      return windows;
    } catch (error) {
      logger.error(`Failed to get windows for PID ${pid}:`, error);
      return [];
    }
  }

  /**
   * Find Chromium-based processes (generic method)
   * @param config Optional configuration for target app discovery
   * @returns ChromiumProcess with all process types and target window
   */
  async findChromiumProcesses(config: TargetAppConfig = DEFAULT_CHROMIUM_CONFIG): Promise<ChromiumProcess> {
    const result: ChromiumProcess = {
      rendererProcesses: [],
      utilityProcesses: [],
    };

    try {
      let processes: ProcessInfo[];
      if (config.processNamePattern instanceof RegExp) {
        const allProcesses = await this.findProcesses('');
        const matcher = config.processNamePattern;
        processes = allProcesses.filter((proc) => matcher.test(proc.name));
      } else {
        const processName = config.processNamePattern || 'chromium';
        processes = await this.findProcesses(processName);
      }

      for (const proc of processes) {
        // Get command line to determine process type
        const detailedInfo = await this.getProcessCommandLine(proc.pid);

        if (detailedInfo?.commandLine) {
          const cmd = detailedInfo.commandLine.toLowerCase();

          if (cmd.includes('--type=renderer')) {
            result.rendererProcesses.push({ ...proc, ...detailedInfo });
          } else if (cmd.includes('--type=gpu-process')) {
            result.gpuProcess = { ...proc, ...detailedInfo };
          } else if (cmd.includes('--type=utility')) {
            result.utilityProcesses.push({ ...proc, ...detailedInfo });
          } else if (!cmd.includes('--type=')) {
            // Main process doesn't have --type argument
            result.mainProcess = { ...proc, ...detailedInfo };
          }
        } else {
          // No command line info, assume main
          if (!result.mainProcess) {
            result.mainProcess = proc;
          }
        }
      }

      // Find target window using config patterns
      const allPids = [
        result.mainProcess?.pid,
        ...result.rendererProcesses.map(p => p.pid),
      ].filter(Boolean) as number[];

      // Build window matching function from config
      const windowMatcher = (w: WindowInfo): boolean => {
        // Check window title pattern
        if (config.windowTitlePattern) {
          const pattern = config.windowTitlePattern;
          if (typeof pattern === 'string') {
            if (w.title.includes(pattern)) return true;
          } else {
            if (pattern.test(w.title)) return true;
          }
        }
        // Check window class pattern
        if (config.windowClassPattern) {
          const pattern = config.windowClassPattern;
          if (typeof pattern === 'string') {
            if (w.className.includes(pattern)) return true;
          } else {
            if (pattern.test(w.className)) return true;
          }
        }
        return false;
      };

      for (const pid of allPids) {
        const windows = await this.getProcessWindows(pid);
        const targetWindow = windows.find(windowMatcher);

        if (targetWindow) {
          result.targetWindow = targetWindow;
          break;
        }
      }

      logger.info('Chromium processes found:', {
        main: result.mainProcess?.pid,
        renderers: result.rendererProcesses.length,
        hasTargetWindow: !!result.targetWindow,
      });

      return result;
    } catch (error) {
      logger.error('Failed to find Chromium processes:', error);
      return result;
    }
  }

  /**
   * @deprecated Use findChromiumProcesses() with custom config parameter instead
   * This method is kept for backward compatibility only
   */
  async findChromiumAppProcesses(): Promise<ChromiumProcess> {
    return this.findChromiumProcesses();
  }

  /**
   * Get process command line arguments
   */
  async getProcessCommandLine(pid: number): Promise<{ commandLine?: string; parentPid?: number }> {
    try {
      const psCommand = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object CommandLine, ParentProcessId | ConvertTo-Json -Compress`;

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: 1024 * 1024 }
      );

      if (!stdout.trim() || stdout.trim() === 'null') {
        return {};
      }

      const data = JSON.parse(stdout.trim());
      return {
        commandLine: data.CommandLine,
        parentPid: data.ParentProcessId,
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
      // Check for --remote-debugging-port in command line
      const { commandLine } = await this.getProcessCommandLine(pid);

      if (commandLine) {
        const match = commandLine.match(/--remote-debugging-port=(\d+)/);
        if (match && match[1]) {
          return parseInt(match[1], 10);
        }
      }

      // Check listening ports for the process
      const psCommand = `Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort | ConvertTo-Json -Compress`;

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: 1024 * 1024 }
      );

      if (stdout.trim() && stdout.trim() !== 'null') {
        const data = JSON.parse(stdout.trim());
        const ports = Array.isArray(data) ? data : [data];

        // Common debug ports
        const debugPorts = [9222, 9229, 9333, 2039];
        for (const port of ports) {
          if (debugPorts.includes(port.LocalPort)) {
            return port.LocalPort;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error(`Failed to check debug port for PID ${pid}:`, error);
      return null;
    }
  }

  /**
   * Find process ID listening on a specific local TCP port.
   * Used by launchWithDebug to resolve Electron child-process handoff.
   */
  private async findPidByListeningPort(port: number): Promise<number | null> {
    try {
      const psCommand = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 OwningProcess | ConvertTo-Json -Compress`;
      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command \"${psCommand}\"`,
        { maxBuffer: 1024 * 1024 }
      );

      if (!stdout.trim() || stdout.trim() === 'null') {
        return null;
      }

      const data = JSON.parse(stdout.trim());
      const first = Array.isArray(data) ? data[0] : data;
      const rawPid = first?.OwningProcess ?? first?.owningProcess ?? first;
      const pid = Number(rawPid);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
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
      const childPid = child.pid || 0;
      const executableName = executablePath.split(/[\\/]/).pop() || 'unknown';

      // Some Electron apps fork quickly: poll a short window and prioritize
      // the PID that is actually listening on the requested debug port.
      let resolvedPid: number | null = childPid > 0 ? childPid : null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const debugPid = await this.findPidByListeningPort(debugPort);
        if (debugPid && debugPid > 0) {
          resolvedPid = debugPid;
        }

        if (resolvedPid && resolvedPid > 0) {
          const process = await this.getProcessByPid(resolvedPid);
          if (process) {
            logger.info(`Launched process with debug port ${debugPort}:`, {
              pid: child.pid,
              resolvedPid,
              executable: executablePath,
            });
            return process;
          }

          if (debugPid && debugPid === resolvedPid) {
            logger.info(`Launched process with debug port ${debugPort}:`, {
              pid: child.pid,
              resolvedPid,
              executable: executablePath,
            });
            return {
              pid: resolvedPid,
              name: executableName,
              executablePath,
            };
          }
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info(`Launched process with debug port ${debugPort}:`, {
        pid: child.pid,
        resolvedPid,
        executable: executablePath,
      });

      if (resolvedPid && resolvedPid > 0) {
        return {
          pid: resolvedPid,
          name: executableName,
          executablePath,
        };
      }

      return null;
    } catch (error) {
      logger.error('Failed to launch process with debug:', error);
      return null;
    }
  }

  /**
   * Inject DLL into process (requires admin privileges)
   * Note: This is for educational/CTF purposes only
   */
  async injectDll(_pid: number, _dllPath: string): Promise<boolean> {
    try {
      if (!Number.isFinite(_pid) || _pid <= 0) {
        logger.error(`Invalid PID for injectDll: ${_pid}`);
        return false;
      }

      const scriptPath = this.scriptLoader.getScriptPath('inject-dll.ps1');
      const normalizedPid = Math.trunc(_pid);
      const escapedDllPath = String(_dllPath).replace(/'/g, "''");

      await execAsync(
        `${this.powershellPath} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -TargetPid ${normalizedPid} -DllPath '${escapedDllPath}'`,
        { maxBuffer: 1024 * 1024 }
      );

      logger.warn('DLL injection is disabled for safety in this implementation');
      return false;
    } catch (error) {
      logger.error('DLL injection failed:', error);
      return false;
    }
  }

  /**
   * Kill a process by PID
   */
  async killProcess(pid: number): Promise<boolean> {
    try {
      if (!Number.isFinite(pid) || pid <= 0) {
        logger.error(`Invalid PID for killProcess: ${pid}`);
        return false;
      }

      const normalizedPid = Math.trunc(pid);
      const psCommand = `Stop-Process -Id ${normalizedPid} -Force -ErrorAction SilentlyContinue; Write-Output "Process ${normalizedPid} killed"`;

      await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: 1024 * 1024 }
      );

      logger.info(`Process ${normalizedPid} killed successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to kill process ${pid}:`, error);
      return false;
    }
  }

  /**
   * Discover all running browsers using window handle enumeration
   * This method uses the BrowserDiscovery module to find browsers
   * by window class names and process names.
   */
  async discoverBrowsers(): Promise<BrowserInfo[]> {
    try {
      const browsers = await this.browserDiscovery.discoverBrowsers();
      logger.info(`Discovered ${browsers.length} browser instances`);
      return browsers;
    } catch (error) {
      logger.error('Failed to discover browsers:', error);
      return [];
    }
  }

  /**
   * Find browser by window class pattern
   * @param classNamePattern Window class pattern to match (supports wildcards like Chrome_WidgetWin_*)
   */
  async findBrowserByWindowClass(classNamePattern: string): Promise<BrowserInfo[]> {
    try {
      const browsers = await this.browserDiscovery.findByWindowClass(classNamePattern);
      logger.info(`Found ${browsers.length} browsers matching window class '${classNamePattern}'`);
      return browsers;
    } catch (error) {
      logger.error(`Failed to find browser by window class '${classNamePattern}':`, error);
      return [];
    }
  }

  /**
   * Find browser by process name
   * @param name Process name to search for (e.g., 'chrome.exe', 'msedge.exe')
   */
  async findBrowserByProcessName(name: string): Promise<BrowserInfo[]> {
    try {
      const browsers = await this.browserDiscovery.findByProcessName(name);
      logger.info(`Found ${browsers.length} browsers matching process name '${name}'`);
      return browsers;
    } catch (error) {
      logger.error(`Failed to find browser by process name '${name}':`, error);
      return [];
    }
  }

  /**
   * Detect debug port for a browser process
   * @param pid Process ID of the browser
   * @param ports Optional array of ports to check (defaults to common debug ports)
   */
  async detectBrowserDebugPort(pid: number, ports?: number[]): Promise<number | null> {
    try {
      const defaultPorts = [9222, 9229, 9333, 2039];
      const portsToCheck = ports || defaultPorts;
      const debugPort = await this.browserDiscovery.detectDebugPort(pid, portsToCheck);

      if (debugPort) {
        logger.info(`Detected debug port ${debugPort} for process ${pid}`);
      } else {
        logger.warn(`No debug port detected for process ${pid}`);
      }

      return debugPort;
    } catch (error) {
      logger.error(`Failed to detect debug port for PID ${pid}:`, error);
      return null;
    }
  }
}
