/** Windows Process Manager for process/window enumeration and debug attachment. */

import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '@utils/logger';
import {
  DEBUG_PORT_CANDIDATES,
  DEFAULT_DEBUG_PORT,
  PROCESS_EXEC_MAX_BUFFER_BYTES,
  PROCESS_LIST_MAX_BUFFER_BYTES,
  WIN_DEBUG_PORT_POLL_ATTEMPTS,
  WIN_DEBUG_PORT_POLL_INTERVAL_MS,
} from '@src/constants';
import { ScriptLoader } from '@native/ScriptLoader';
import { BrowserDiscovery, type BrowserInfo } from '@modules/browser/BrowserDiscovery';
import { findChromiumProcessesWithConfig } from '@modules/process/ProcessManager.chromium';
import {
  buildChromiumDebugLaunch,
  isChromiumLikeExecutable,
} from '@modules/process/chromium-launch';
import {
  DEFAULT_CHROMIUM_CONFIG,
  type ChromiumProcess,
  type TargetAppConfig,
  type WindowInfo,
  type ProcessInfo,
} from '@modules/process/ProcessManager.types';
import { ProcessRegistry } from '@utils/ProcessRegistry';

export {
  DEFAULT_CHROMIUM_CONFIG,
  type ChromiumProcess,
  type ProcessInfo,
  type TargetAppConfig,
  type WindowInfo,
};

const execAsync = promisify(exec);
const PROCESS_SNAPSHOT_CACHE_TTL_MS = 3000;

interface ProcessSnapshot {
  expiresAt: number;
  /** ALL processes, unfiltered — one PowerShell call serves every pattern. */
  all: ProcessInfo[];
}

/** Strip PowerShell-special characters from a pattern to prevent injection. */
function sanitizePsPattern(s: string): string {
  return String(s || '').replace(/[`$"'{}();|<>@#%!\\\n\r]/g, '');
}

/** Validate and normalize a PID value. Throws on invalid input. */
function safePid(pid: number): number {
  const n = Math.trunc(Number(pid));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid PID: ${pid}`);
  return n;
}

/** Windows Process Manager implementation. */
export class ProcessManager {
  private powershellPath: string = 'powershell.exe';
  private scriptLoader: ScriptLoader;
  private browserDiscovery: BrowserDiscovery;
  private processSnapshot: ProcessSnapshot | null = null;

  constructor() {
    this.scriptLoader = new ScriptLoader();
    this.browserDiscovery = new BrowserDiscovery();
    logger.info('ProcessManager initialized for Windows platform');
  }

  /**
   * Enumerate processes whose name contains `pattern`.
   *
   * A single all-processes PowerShell snapshot is fetched once per TTL and
   * shared across every pattern (the old code spawned one `Get-Process -Name`
   * per distinct pattern). Filtering now happens in JS, so N lookups in a
   * session cost ONE subprocess spawn instead of N. `Get-Process` has no
   * `-Name` filter here — the wildcard match is reproduced case-insensitively
   * below. An empty pattern returns the full unfiltered snapshot (relied on by
   * the Chromium regex discovery path).
   */
  async findProcesses(pattern: string): Promise<ProcessInfo[]> {
    try {
      const normalizedPattern = sanitizePsPattern(String(pattern || '').trim());
      const filterKey = normalizedPattern.toLowerCase();
      const now = Date.now();

      let snapshot = this.processSnapshot;
      if (!snapshot || snapshot.expiresAt <= now) {
        const psCommand =
          `Get-Process -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path, ` +
          `MainWindowTitle, MainWindowHandle, CPU, WorkingSet64 | ConvertTo-Json -Compress`;

        const { stdout } = await execAsync(
          `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
          { maxBuffer: PROCESS_LIST_MAX_BUFFER_BYTES, windowsHide: true },
        );

        const lines = stdout.trim();
        const all: ProcessInfo[] = [];
        if (lines && lines !== 'null') {
          const data = JSON.parse(lines);
          const procList = Array.isArray(data) ? data : [data];
          for (const proc of procList) {
            all.push({
              pid: proc.Id,
              name: proc.ProcessName,
              executablePath: proc.Path,
            });
          }
        }

        snapshot = { expiresAt: now + PROCESS_SNAPSHOT_CACHE_TTL_MS, all };
        this.processSnapshot = snapshot;
        logger.info(`Process snapshot refreshed: ${all.length} processes`);
      }

      if (!filterKey) {
        return snapshot.all;
      }
      const filtered = snapshot.all.filter((proc) =>
        String(proc.name ?? '')
          .toLowerCase()
          .includes(filterKey),
      );
      logger.info(`Found ${filtered.length} processes matching '${normalizedPattern}'`);
      return filtered;
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
      const psCommand =
        `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | ` +
        'Select-Object Id, ProcessName, Path, MainWindowTitle, MainWindowHandle, CPU, WorkingSet64, StartTime | ' +
        'ConvertTo-Json -Compress';

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: PROCESS_EXEC_MAX_BUFFER_BYTES, windowsHide: true },
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
      pid = safePid(pid);
      const scriptPath = await this.scriptLoader.getScriptPath('enum-windows.ps1');

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -TargetPid ${pid}`,
        { maxBuffer: PROCESS_EXEC_MAX_BUFFER_BYTES, windowsHide: true },
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
  async findChromiumProcesses(
    config: TargetAppConfig = DEFAULT_CHROMIUM_CONFIG,
  ): Promise<ChromiumProcess> {
    return findChromiumProcessesWithConfig(config, {
      findProcesses: (pattern) => this.findProcesses(pattern),
      getProcessCommandLine: (pid) => this.getProcessCommandLine(pid),
      getProcessWindows: (pid) => this.getProcessWindows(pid),
      logInfo: (message, payload) => logger.info(message, payload),
      logError: (message, error) => logger.error(message, error),
    });
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
      pid = safePid(pid);
      const psCommand =
        `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ` +
        `CommandLine, ParentProcessId | ` +
        'ConvertTo-Json -Compress';

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: PROCESS_EXEC_MAX_BUFFER_BYTES, windowsHide: true },
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
  async checkDebugPort(pid: number, options?: { commandLine?: string }): Promise<number | null> {
    try {
      pid = safePid(pid);
      const commandLine =
        options?.commandLine ?? (await this.getProcessCommandLine(pid)).commandLine;

      if (commandLine) {
        const match = commandLine.match(/--remote-debugging-port=(\d+)/);
        if (match?.[1]) {
          return parseInt(match[1], 10);
        }
      }

      const psCommand =
        `Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue ` +
        'Select-Object LocalPort | ConvertTo-Json -Compress';

      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: PROCESS_EXEC_MAX_BUFFER_BYTES, windowsHide: true },
      );

      if (stdout.trim() && stdout.trim() !== 'null') {
        const data = JSON.parse(stdout.trim());
        const ports = Array.isArray(data) ? data : [data];

        for (const port of ports) {
          if (DEBUG_PORT_CANDIDATES.includes(port.LocalPort)) {
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
      const psCommand =
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue ` +
        'Select-Object -First 1 OwningProcess | ConvertTo-Json -Compress';
      const { stdout } = await execAsync(
        `${this.powershellPath} -NoProfile -Command "${psCommand}"`,
        { maxBuffer: PROCESS_EXEC_MAX_BUFFER_BYTES, windowsHide: true },
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
    debugPort: number = DEFAULT_DEBUG_PORT,
    args: string[] = [],
  ): Promise<ProcessInfo | null> {
    try {
      const plan = buildChromiumDebugLaunch(executablePath, debugPort, args);

      const child = spawn(executablePath, plan.debugArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });

      // A spawn failure (ENOENT for a missing executable, EACCES, …) is
      // delivered as an async 'error' EVENT, not a throw — without this
      // listener Node raises an uncaught exception and takes the whole server
      // down. Capture it so the launch reports a clean failure instead.
      let spawnError: Error | null = null;
      child.once('error', (error: Error) => {
        spawnError = error;
      });

      child.unref();
      ProcessRegistry.register(child);
      const childPid = child.pid || 0;
      const executableName = executablePath.split(/[\\/]/).pop() || 'unknown';

      /** True when the child process has terminated (or never started). */
      const childExited = () =>
        spawnError !== null ||
        typeof child.exitCode === 'number' ||
        typeof child.signalCode === 'string';

      /**
       * Some Electron/Chrome builds fork a real browser process and the
       * launcher exits right away — check for a listener on the debug port
       * before treating a launcher exit as failure. Only trust a listener
       * whose owning process matches the target we just spawned.
       */
      const adoptListener = async (): Promise<ProcessInfo | null> => {
        const debugPid = await this.findPidByListeningPort(debugPort);
        if (!debugPid || debugPid <= 0) return null;
        const listener = await this.getProcessByPid(debugPid);
        if (listener?.executablePath && isChromiumLikeExecutable(listener.executablePath)) {
          return listener;
        }
        return {
          pid: debugPid,
          name: listener?.name ?? executableName,
          executablePath: listener?.executablePath ?? executablePath,
        };
      };

      return await this.resolveLaunchOutcome({
        childPid,
        executablePath,
        executableName,
        debugPort,
        chromiumLike: plan.chromiumLike,
        childExited,
        adoptListener,
        launcherPid: child.pid,
        spawnErrorMessage: spawnError === null ? undefined : (spawnError as Error).message,
      });
    } catch (error) {
      logger.error('Failed to launch process with debug:', error);
      return null;
    }
  }

  /**
   * Turn a spawned child into a `ProcessInfo` (or null).
   *
   * Split out of {@link launchWithDebug} purely to keep that function's
   * cognitive complexity inside the repo's fallow ceiling (40); behaviour is
   * identical to the inline version and the phases keep their original order:
   *   1. fast-fail when the launcher died immediately (adopt a live listener)
   *   2. non-Chromium targets return the spawn as-is (no debug-port polling)
   *   3. Chromium targets poll a short window for the port owner
   */
  private async resolveLaunchOutcome(options: {
    childPid: number;
    executablePath: string;
    executableName: string;
    debugPort: number;
    chromiumLike: boolean;
    childExited: () => boolean;
    adoptListener: () => Promise<ProcessInfo | null>;
    launcherPid: number | undefined;
    spawnErrorMessage: string | undefined;
  }): Promise<ProcessInfo | null> {
    const {
      childPid,
      executablePath,
      executableName,
      debugPort,
      chromiumLike,
      childExited,
      adoptListener,
      launcherPid,
      spawnErrorMessage,
    } = options;

    // Fast-fail: a target that dies immediately without ever opening the
    // debug port (e.g. rejected the debug flag or failed to start) must
    // not burn the full 10s poll window. A launcher that forked a child
    // which opened the port is a success, not a failure.
    if (childExited()) {
      const adopted = await adoptListener();
      if (adopted) {
        logger.info(`Launcher exited but debug port ${debugPort} is live:`, {
          launcherPid,
          resolvedPid: adopted.pid,
          executable: executablePath,
        });
        return adopted;
      }
      logger.error(`Debug launch target exited immediately: ${executablePath}`, {
        spawnErrorMessage,
      });
      return null;
    }

    // Non-Chromium targets get no debug flag, so port polling is pointless
    // and would risk adopting an unrelated listener — return the spawn as-is.
    if (!chromiumLike) {
      const process = childPid > 0 ? await this.getProcessByPid(childPid) : null;
      if (process) {
        logger.info(`Launched process (debug port not supported):`, {
          pid: launcherPid,
          executable: executablePath,
        });
        return process;
      }
      if (childPid > 0) {
        return { pid: childPid, name: executableName, executablePath };
      }
      logger.error(`Failed to resolve spawned non-Chromium process: ${executablePath}`);
      return null;
    }

    // Some Electron apps fork quickly: poll a short window and prioritize
    // the PID that is actually listening on the requested debug port.
    // Adopted listeners must belong to this launch: when the port is
    // already held by another browser, the owning process's executable
    // will not match the target we just spawned.
    let resolvedPid: number | null = childPid > 0 ? childPid : null;
    for (let attempt = 0; attempt < WIN_DEBUG_PORT_POLL_ATTEMPTS; attempt++) {
      if (childExited()) {
        const adopted = await adoptListener();
        if (adopted) {
          logger.info(`Launcher exited but debug port ${debugPort} is live:`, {
            launcherPid,
            resolvedPid: adopted.pid,
            executable: executablePath,
          });
          return adopted;
        }
        logger.error(
          `Debug launch target exited before opening port ${debugPort}: ${executablePath}`,
          { attempt, spawnErrorMessage },
        );
        return null;
      }

      const debugPid = await this.findPidByListeningPort(debugPort);
      if (debugPid && debugPid > 0 && debugPid !== childPid) {
        const listener = await this.getProcessByPid(debugPid);
        // Owner process unknown (lookup failed): adopt with the spawn
        // target's identity, matching pre-#207 fallback behavior.
        if (
          !listener ||
          !listener.executablePath ||
          isChromiumLikeExecutable(listener.executablePath)
        ) {
          resolvedPid = debugPid;
        }
      }

      if (resolvedPid && resolvedPid > 0) {
        const process = await this.getProcessByPid(resolvedPid);
        if (process) {
          logger.info(`Launched process with debug port ${debugPort}:`, {
            pid: launcherPid,
            resolvedPid,
            executable: executablePath,
          });
          return process;
        }

        if (debugPid && debugPid === resolvedPid) {
          logger.info(`Launched process with debug port ${debugPort}:`, {
            pid: launcherPid,
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

      await new Promise((resolve) => setTimeout(resolve, WIN_DEBUG_PORT_POLL_INTERVAL_MS));
    }

    logger.info(`Launched process with debug port ${debugPort}:`, {
      pid: launcherPid,
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
  }

  /**
   * DLL injection is not implemented — always returns false.
   *
   * This is a hard-disabled stub. It deliberately does NOT spawn a shell and
   * does NOT execute any script.
   *
   * A previous revision shipped an `inject-dll.ps1` helper that declared the
   * canonical injection APIs (OpenProcess / VirtualAllocEx / WriteProcessMemory /
   * CreateRemoteThread) but never called them, and invoked it via PowerShell with
   * `-ExecutionPolicy Bypass`. Both the script and the spawn have been removed:
   * they performed no work, and shipping a file named `inject-dll.ps1` alongside
   * a bypass-execution shell call is indistinguishable from malware to automated
   * review of the published package. The public contract is unchanged — this
   * method has always returned false.
   */
  async injectDll(_pid: number, _dllPath: string): Promise<boolean> {
    if (!Number.isFinite(_pid) || _pid <= 0) {
      logger.error(`Invalid PID for injectDll: ${_pid}`);
      return false;
    }

    logger.warn('DLL injection is disabled for safety in this implementation');
    return false;
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
      // `-ErrorAction Stop` is load-bearing: with `SilentlyContinue` a
      // non-existent PID leaves PowerShell at exit code 0, so the caller was
      // told "killed successfully" for a process that never existed. With Stop
      // the cmdlet error becomes a non-zero exit and the catch below reports
      // the honest false.
      const psCommand = `Stop-Process -Id ${normalizedPid} -Force -ErrorAction Stop; Write-Output "killed"`;

      await execAsync(`${this.powershellPath} -NoProfile -Command "${psCommand}"`, {
        maxBuffer: PROCESS_EXEC_MAX_BUFFER_BYTES,
        windowsHide: true,
      });

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
      const portsToCheck = ports || DEBUG_PORT_CANDIDATES;
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
