import { ScriptLoader } from '../../native/ScriptLoader.js';

export interface BrowserInfo {
  type: 'chrome' | 'edge' | 'firefox' | 'unknown';
  pid: number;
  hwnd?: string;
  title?: string;
  debugPort?: number;
}

export interface BrowserSignature {
  windowClasses: string[];
  processNames: string[];
  mainWindowTitle?: RegExp;
  debugPorts: number[];
}

export class BrowserDiscovery {
  private scriptLoader: ScriptLoader;

  private browserSignatures: Map<string, BrowserSignature> = new Map([
    ['chrome', {
      windowClasses: ['Chrome_WidgetWin_0', 'Chrome_WidgetWin_1', 'Chrome_WidgetWin_*'],
      processNames: ['chrome.exe', 'chrome'],
      mainWindowTitle: /.*- Google Chrome$/,
      debugPorts: [9222, 9229, 9333],
    }],
    ['edge', {
      windowClasses: ['Edge_WidgetWin_0', 'Edge_WidgetWin_1', 'Edge_WidgetWin_*'],
      processNames: ['msedge.exe', 'msedge'],
      mainWindowTitle: /.*- Microsoft Edge$/,
      debugPorts: [9222, 9229],
    }],
    ['firefox', {
      windowClasses: ['MozillaWindowClass'],
      processNames: ['firefox.exe', 'firefox'],
      mainWindowTitle: /.*- Mozilla Firefox$/,
      debugPorts: [9222],
    }],
  ]);

  constructor() {
    this.scriptLoader = new ScriptLoader();
  }

  /** Strip all characters that are dangerous in PowerShell contexts. */
  private sanitizePsInput(value: string): string {
    return value.replace(/[`$"'{}();|<>@#%!\\\n\r]/g, '');
  }

  private escapePowerShellSingleQuoted(value: string): string {
    return this.sanitizePsInput(value).replace(/'/g, "''");
  }

  /**
   * Discover all running browsers
   */
  async discoverBrowsers(): Promise<BrowserInfo[]> {
    const results: BrowserInfo[] = [];

    for (const [type, signature] of this.browserSignatures) {
      const browsers = await this.findBySignature(type, signature);
      results.push(...browsers);
    }

    return results;
  }

  /**
   * Discover browsers by signature
   */
  private async findBySignature(type: string, signature: BrowserSignature): Promise<BrowserInfo[]> {
    const results: BrowserInfo[] = [];
    const seenPids = new Set<number>();

    // 1. Find by process name
    for (const processName of signature.processNames) {
      const processes = await this.findByProcessName(processName);
      for (const proc of processes) {
        if (!seenPids.has(proc.pid)) {
          seenPids.add(proc.pid);
          results.push({
            type: type as BrowserInfo['type'],
            pid: proc.pid,
            hwnd: proc.hwnd,
            title: proc.title,
          });
        }
      }
    }

    // 2. Find by window class name
    for (const windowClass of signature.windowClasses) {
      const windows = await this.findByWindowClass(windowClass);
      for (const win of windows) {
        if (!seenPids.has(win.pid)) {
          seenPids.add(win.pid);
          results.push({
            type: type as BrowserInfo['type'],
            pid: win.pid,
            hwnd: win.hwnd,
            title: win.title,
          });
        }
      }
    }

    // 3. Detect debug port
    for (const browser of results) {
      const debugPort = await this.detectDebugPort(browser.pid, signature.debugPorts);
      if (debugPort) {
        browser.debugPort = debugPort;
      }
    }

    return results;
  }

  /**
   * Discover browser by window handle
   */
  async findByWindowClass(classNamePattern: string): Promise<BrowserInfo[]> {
    const scriptPath = this.scriptLoader.getScriptPath('enum-windows-by-class.ps1');

    try {
      const escapedPattern = this.escapePowerShellSingleQuoted(classNamePattern);
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ClassPattern', escapedPattern],
        { maxBuffer: 1024 * 1024 * 10 }
      );

      return this.parseWindowsResult(stdout, classNamePattern);
    } catch (error) {
      console.error(`Failed to find windows by class '${classNamePattern}':`, error);
      return [];
    }
  }

  /**
   * Discover browser by process name
   */
  async findByProcessName(name: string): Promise<BrowserInfo[]> {
    try {
      const escapedPattern = this.escapePowerShellSingleQuoted(name);
      const psCommand = `$Pattern='${escapedPattern}'; Get-Process -Name "*$Pattern*" -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path, MainWindowTitle, MainWindowHandle, CPU, WorkingSet64 | ConvertTo-Json -Compress`;
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', psCommand],
        { maxBuffer: 1024 * 1024 * 10 }
      );

      return this.parseProcessResult(stdout, name);
    } catch (error) {
      console.error(`Failed to find process by name '${name}':`, error);
      return [];
    }
  }

  /**
   * Parse Windows window results
   */
  private parseWindowsResult(stdout: string, _classNamePattern: string): BrowserInfo[] {
    const results: BrowserInfo[] = [];

    if (!stdout.trim() || stdout.trim() === 'null') {
      return results;
    }

    try {
      const data = JSON.parse(stdout.trim());
      const windows = Array.isArray(data) ? data : [data];

      for (const win of windows) {
        // Check if window title matches browser pattern
        let type: BrowserInfo['type'] = 'unknown';
        const title = win.Title || '';

        for (const [browserType, signature] of this.browserSignatures) {
          if (signature.mainWindowTitle?.test(title)) {
            type = browserType as BrowserInfo['type'];
            break;
          }
        }

        // If window class name matches, also consider it a browser
        if (type === 'unknown') {
          for (const [browserType, signature] of this.browserSignatures) {
            for (const pattern of signature.windowClasses) {
              const regexPattern = pattern.replace(/\*/g, '.*');
              if (new RegExp(regexPattern).test(win.ClassName || '')) {
                type = browserType as BrowserInfo['type'];
                break;
              }
            }
            if (type !== 'unknown') break;
          }
        }

        results.push({
          type,
          pid: win.ProcessId,
          hwnd: win.Handle,
          title: win.Title,
        });
      }
    } catch (error) {
      console.error('Failed to parse windows result:', error);
    }

    return results;
  }

  /**
   * Parse process results
   */
  private parseProcessResult(stdout: string, _name: string): BrowserInfo[] {
    const results: BrowserInfo[] = [];

    if (!stdout.trim() || stdout.trim() === 'null') {
      return results;
    }

    try {
      const data = JSON.parse(stdout.trim());
      const processes = Array.isArray(data) ? data : [data];

      for (const proc of processes) {
        let type: BrowserInfo['type'] = 'unknown';
        const procName = (proc.ProcessName || '').toLowerCase();

        // Determine browser type by process name
        if (procName.includes('chrome')) {
          type = 'chrome';
        } else if (procName.includes('msedge') || procName.includes('edge')) {
          type = 'edge';
        } else if (procName.includes('firefox')) {
          type = 'firefox';
        }

        results.push({
          type,
          pid: proc.Id,
          hwnd: proc.MainWindowHandle?.toString(),
          title: proc.MainWindowTitle,
        });
      }
    } catch (error) {
      console.error('Failed to parse process result:', error);
    }

    return results;
  }

  /**
   * Detect debug port
   */
  async detectDebugPort(pid: number, ports: number[]): Promise<number | null> {
    // First check command line arguments for debug port
    const debugPortFromCmdline = await this.checkDebugPortFromCommandLine(pid);
    if (debugPortFromCmdline) {
      return debugPortFromCmdline;
    }

    // Check specified port list
    for (const port of ports) {
      if (await this.checkPort(pid, port)) {
        return port;
      }
    }

    return null;
  }

  /**
   * Check debug port from command line arguments
   */
  private async checkDebugPortFromCommandLine(pid: number): Promise<number | null> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    try {
      if (!Number.isFinite(pid) || pid <= 0) {
        return null;
      }

      const psCommand = `Get-CimInstance Win32_Process -Filter "ProcessId = ${Math.trunc(pid)}" | Select-Object CommandLine, ParentProcessId | ConvertTo-Json -Compress`;
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', psCommand],
        { maxBuffer: 1024 * 1024 }
      );

      if (!stdout.trim() || stdout.trim() === 'null') {
        return null;
      }

      const data = JSON.parse(stdout.trim());
      const commandLine = data.CommandLine || '';

      const match = commandLine.match(/--remote-debugging-port=(\d+)/);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if specified port is being listened by process
   */
  private async checkPort(pid: number, port: number): Promise<boolean> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    try {
      if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(port) || port <= 0) {
        return false;
      }

      const psCommand = `Get-NetTCPConnection -OwningProcess ${Math.trunc(pid)} -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort | ConvertTo-Json -Compress`;
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', psCommand],
        { maxBuffer: 1024 * 1024 }
      );

      if (!stdout.trim() || stdout.trim() === 'null') {
        return false;
      }

      const data = JSON.parse(stdout.trim());
      const connections = Array.isArray(data) ? data : [data];

      for (const conn of connections) {
        if (conn.LocalPort === port) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }
}
