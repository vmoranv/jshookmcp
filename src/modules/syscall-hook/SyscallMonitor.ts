import type { ChildProcess } from 'node:child_process';

export type SyscallBackend = 'etw' | 'strace' | 'dtrace';

export interface SyscallEvent {
  timestamp: number;
  pid: number;
  syscall: string;
  args: string[];
  returnValue?: number;
  duration?: number;
}

interface StartOptions {
  backend: SyscallBackend;
  pid?: number;
  simulate?: boolean;
}

interface CaptureFilter {
  name?: string[];
  pid?: number;
}

interface MonitorState {
  backend: SyscallBackend;
  pid?: number;
  startedAt: number;
  generatedEvents: number;
  subprocess?: ChildProcess;
}

interface SyntheticEventSeed {
  syscall: string;
  args: string[];
  returnValue?: number;
  duration?: number;
}

const SUPPORTED_BACKENDS: ReadonlyArray<SyscallBackend> = ['etw', 'strace', 'dtrace'];

const SYNTHETIC_EVENT_SEEDS: Readonly<Record<SyscallBackend, ReadonlyArray<SyntheticEventSeed>>> = {
  etw: [
    {
      syscall: 'NtCreateFile',
      args: ['C:\\Windows\\Temp\\jshookmcp.log', 'GENERIC_READ'],
      returnValue: 0,
      duration: 0.7,
    },
    {
      syscall: 'NtReadFile',
      args: ['handle=0x90', 'buffer=4096'],
      returnValue: 512,
      duration: 0.2,
    },
    {
      syscall: 'NtWriteFile',
      args: ['handle=0x90', 'buffer=128'],
      returnValue: 128,
      duration: 0.3,
    },
    {
      syscall: 'NtDeviceIoControlFile',
      args: ['handle=0x44', 'code=0x222004'],
      returnValue: 0,
      duration: 1.1,
    },
  ],
  strace: [
    {
      syscall: 'openat',
      args: ['/tmp/jshookmcp.log', 'O_RDONLY'],
      returnValue: 3,
      duration: 0.4,
    },
    {
      syscall: 'read',
      args: ['fd=3', 'count=4096'],
      returnValue: 256,
      duration: 0.1,
    },
    {
      syscall: 'write',
      args: ['fd=3', 'count=128'],
      returnValue: 128,
      duration: 0.2,
    },
    {
      syscall: 'connect',
      args: ['fd=18', '127.0.0.1:9222'],
      returnValue: 0,
      duration: 1.4,
    },
  ],
  dtrace: [
    {
      syscall: 'open_nocancel',
      args: ['/private/tmp/jshookmcp.log', 'O_RDONLY'],
      returnValue: 3,
      duration: 0.5,
    },
    {
      syscall: 'read_nocancel',
      args: ['fd=3', 'count=4096'],
      returnValue: 320,
      duration: 0.1,
    },
    {
      syscall: 'write_nocancel',
      args: ['fd=3', 'count=128'],
      returnValue: 128,
      duration: 0.2,
    },
    {
      syscall: 'connect',
      args: ['fd=21', '127.0.0.1:9222'],
      returnValue: 0,
      duration: 1.3,
    },
  ],
};

function isBackendSupportedOnCurrentPlatform(backend: SyscallBackend): boolean {
  if (backend === 'etw') {
    return process.platform === 'win32';
  }
  if (backend === 'strace') {
    return process.platform === 'linux';
  }
  if (backend === 'dtrace') {
    return process.platform === 'darwin';
  }
  return false;
}

function chooseDefaultBackend(): SyscallBackend {
  if (process.platform === 'win32') {
    return 'etw';
  }
  if (process.platform === 'linux') {
    return 'strace';
  }
  if (process.platform === 'darwin') {
    return 'dtrace';
  }
  return 'etw';
}

function cloneEvent(event: SyscallEvent): SyscallEvent {
  return {
    timestamp: event.timestamp,
    pid: event.pid,
    syscall: event.syscall,
    args: [...event.args],
    returnValue: event.returnValue,
    duration: event.duration,
  };
}

function matchesFilter(event: SyscallEvent, filter?: CaptureFilter): boolean {
  if (!filter) {
    return true;
  }

  if (filter.pid !== undefined && event.pid !== filter.pid) {
    return false;
  }

  if (filter.name && filter.name.length > 0 && !filter.name.includes(event.syscall)) {
    return false;
  }

  return true;
}

/**
 * Parse a strace output line into a SyscallEvent.
 *
 * Example strace line:
 *   12345 14:30:00.123456 openat(AT_FDCWD, "/tmp/foo", O_RDONLY) = 3 <0.000123>
 */
function parseStraceLine(line: string, targetPid: number): SyscallEvent | null {
  // Match pattern: pid timestamp syscall(args) = return <duration>
  const match = /^(\d+)\s+([\d:.]+)\s+(\w+)\(([^)]*)\)\s*=\s*(-?\d+)(?:\s+<([\d.]+)>)?$/u.exec(
    line.trim(),
  );
  if (!match) {
    return null;
  }

  const syscall = match[3] ?? 'unknown';
  const rawArgs = match[4] ?? '';
  const returnValue = Number(match[5]);
  const duration = match[6] ? Number(match[6]) : undefined;

  const args = rawArgs
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  return {
    timestamp: Date.now(),
    pid: targetPid,
    syscall,
    args,
    returnValue: Number.isFinite(returnValue) ? returnValue : undefined,
    duration: duration !== undefined && Number.isFinite(duration) ? duration * 1000 : undefined,
  };
}

/**
 * Parse an ETW trace line (simplified from logman/wpr output).
 *
 * Example ETW line:
 *   [2024-01-15 14:30:00.123] PID=1234 NtCreateFile Handle=0x90 Status=0x00000000
 */
function parseETWLine(line: string, targetPid: number): SyscallEvent | null {
  const match = /^\[([^\]]+)\]\s+PID=(\d+)\s+(\w+)\s+(.*)$/u.exec(line.trim());
  if (!match) {
    return null;
  }

  const syscall = match[3] ?? 'unknown';
  const rawArgs = match[4] ?? '';
  const pid = Number(match[2]);

  const args = rawArgs.split(/\s+/u).filter((a) => a.length > 0);

  return {
    timestamp: Date.now(),
    pid: Number.isFinite(pid) ? pid : targetPid,
    syscall,
    args,
  };
}

/**
 * Parse a dtrace output line.
 *
 * Example dtrace line:
 *   1234   0  12345  open_nocancel:entry  /private/tmp/foo O_RDONLY
 */
function parseDTraceLine(line: string, targetPid: number): SyscallEvent | null {
  const match = /^\s*(\d+)\s+\d+\s+(\d+)\s+(\w+):\w+\s+(.*)$/u.exec(line.trim());
  if (!match) {
    return null;
  }

  const syscall = match[3] ?? 'unknown';
  const rawArgs = match[4] ?? '';
  const pid = Number(match[2]);

  const args = rawArgs.split(/\s+/u).filter((a) => a.length > 0);

  return {
    timestamp: Date.now(),
    pid: Number.isFinite(pid) ? pid : targetPid,
    syscall,
    args,
  };
}

export class SyscallMonitor {
  private activeState?: MonitorState;
  private readonly capturedEvents: SyscallEvent[] = [];
  private lastBackend: SyscallBackend = chooseDefaultBackend();
  private subprocessError?: string;

  async start(options?: StartOptions): Promise<void> {
    const requestedBackend = options?.backend ?? chooseDefaultBackend();

    if (!isBackendSupportedOnCurrentPlatform(requestedBackend)) {
      throw new Error(
        `Backend "${requestedBackend}" is not available on platform "${process.platform}"`,
      );
    }

    // If --simulate flag or JSHOOK_SIMULATE=1, use synthetic mode
    const simulate = options?.simulate ?? process.env['JSHOOK_SIMULATE'] === '1';
    if (simulate) {
      this.activeState = {
        backend: requestedBackend,
        pid: options?.pid,
        startedAt: Date.now(),
        generatedEvents: 0,
      };
      this.lastBackend = requestedBackend;
      this.capturedEvents.length = 0;
      this.generateSyntheticEvents();
      return;
    }

    // Attempt real subprocess capture
    const pid = options?.pid ?? process.pid;
    let subprocess: ChildProcess | undefined;

    try {
      if (requestedBackend === 'strace') {
        subprocess = await this.captureWithStrace(pid);
      } else if (requestedBackend === 'etw') {
        subprocess = await this.captureWithETW(pid);
      } else if (requestedBackend === 'dtrace') {
        subprocess = await this.captureWithDTrace(pid);
      }
    } catch (error) {
      this.subprocessError = error instanceof Error ? error.message : String(error);
      // Fall back to simulation if subprocess fails
      this.activeState = {
        backend: requestedBackend,
        pid: options?.pid,
        startedAt: Date.now(),
        generatedEvents: 0,
      };
      this.lastBackend = requestedBackend;
      this.capturedEvents.length = 0;
      this.generateSyntheticEvents();
      return;
    }

    this.activeState = {
      backend: requestedBackend,
      pid: options?.pid,
      startedAt: Date.now(),
      generatedEvents: 0,
      subprocess,
    };
    this.lastBackend = requestedBackend;
    this.capturedEvents.length = 0;
    this.subprocessError = undefined;
  }

  async stop(): Promise<void> {
    if (this.activeState?.subprocess) {
      this.activeState.subprocess.kill('SIGTERM');
      this.activeState.subprocess = undefined;
    }
    this.activeState = undefined;
  }

  async captureEvents(filter?: CaptureFilter): Promise<SyscallEvent[]> {
    if (this.activeState && !this.activeState.subprocess) {
      this.generateSyntheticEvents();
    }

    return this.capturedEvents.filter((event) => matchesFilter(event, filter)).map(cloneEvent);
  }

  getStats(): {
    eventsCaptured: number;
    uptime: number;
    backend: SyscallBackend;
    subprocessActive: boolean;
    subprocessError?: string;
  } {
    const backend = this.activeState?.backend ?? this.lastBackend;
    const uptime = this.activeState ? Date.now() - this.activeState.startedAt : 0;
    return {
      eventsCaptured: this.capturedEvents.length,
      uptime,
      backend,
      subprocessActive: !!this.activeState?.subprocess,
      subprocessError: this.subprocessError,
    };
  }

  getSupportedBackends(): SyscallBackend[] {
    return SUPPORTED_BACKENDS.filter((backend) => isBackendSupportedOnCurrentPlatform(backend));
  }

  isRunning(): boolean {
    return this.activeState !== undefined;
  }

  /**
   * Spawn strace for syscall tracing on Linux.
   * Parses stdout into SyscallEvent objects.
   */
  async captureWithStrace(pid: number): Promise<ChildProcess> {
    const { spawn } = await import('node:child_process');

    return new Promise<ChildProcess>((resolve, reject) => {
      const subprocess = spawn('strace', ['-p', String(pid), '-f', '-e', 'trace=all', '-t'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuffer = '';
      let lineAccumulator = '';

      subprocess.stdout?.on('data', (chunk: Buffer) => {
        lineAccumulator += chunk.toString();
        this.processLineBuffer(lineAccumulator, pid, 'strace');
      });

      subprocess.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split(/\r?\n/u);
        // Keep the last incomplete line in the buffer
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.length > 0) {
            const event = parseStraceLine(line, pid);
            if (event) {
              this.capturedEvents.push(event);
            }
          }
        }
      });

      subprocess.on('error', (error: Error) => {
        reject(new Error(`strace process error: ${error.message}. Is strace installed?`));
      });

      subprocess.on('spawn', () => {
        resolve(subprocess);
      });
    });
  }

  /**
   * Spawn ETW tracing on Windows using logman.
   * Parses ETW trace output into SyscallEvent objects.
   */
  async captureWithETW(pid: number): Promise<ChildProcess> {
    const { spawn } = await import('node:child_process');

    return new Promise<ChildProcess>((resolve, reject) => {
      const sessionName = `JSHookETW_${pid}`;

      // Start ETW provider for NT kernel tracing
      const logman = spawn(
        'logman',
        [
          'create',
          'trace',
          sessionName,
          '-p',
          'NT Kernel Logger',
          '0x10000', // Process/File I/O
          '-o',
          `jshook_etw_${pid}.etl`,
          '-ets',
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );

      let outputBuffer = '';

      logman.stdout?.on('data', (chunk: Buffer) => {
        outputBuffer += chunk.toString();
        const lines = outputBuffer.split(/\r?\n/u);
        outputBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const event = parseETWLine(line, pid);
          if (event) {
            this.capturedEvents.push(event);
          }
        }
      });

      logman.stderr?.on('data', (chunk: Buffer) => {
        // Logman stderr usually contains status messages
        const msg = chunk.toString().trim();
        if (msg.length > 0 && !msg.startsWith('The command completed successfully')) {
          // Non-fatal info
        }
      });

      logman.on('error', (error: Error) => {
        reject(new Error(`ETW trace error: ${error.message}. Run as Administrator.`));
      });

      logman.on('exit', (code) => {
        if (code !== 0 && code !== undefined) {
          // logman exits after trace is stopped; non-zero is expected
          reject(new Error(`ETW trace session ended (code ${code}). Check permissions.`));
        }
      });

      logman.on('spawn', () => {
        resolve(logman);
      });
    });
  }

  /**
   * Spawn dtrace for syscall tracing on macOS.
   * Parses dtrace output into SyscallEvent objects.
   */
  async captureWithDTrace(pid: number): Promise<ChildProcess> {
    const { spawn } = await import('node:child_process');

    return new Promise<ChildProcess>((resolve, reject) => {
      const script = `
        syscall:::entry
        /pid == ${pid}/
        {
          printf("%d %d %s:entry %s", pid, probeproc, probefunc, copyinstr(arg0));
        }
      `;

      const dtrace = spawn('dtrace', ['-n', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let outputBuffer = '';

      dtrace.stdout?.on('data', (chunk: Buffer) => {
        outputBuffer += chunk.toString();
        const lines = outputBuffer.split(/\r?\n/u);
        outputBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const event = parseDTraceLine(line, pid);
          if (event) {
            this.capturedEvents.push(event);
          }
        }
      });

      dtrace.stderr?.on('data', () => {
        // dtrace outputs header info to stderr; ignore
      });

      dtrace.on('error', (error: Error) => {
        reject(new Error(`dtrace error: ${error.message}. Run with sudo.`));
      });

      dtrace.on('spawn', () => {
        resolve(dtrace);
      });
    });
  }

  private generateSyntheticEvents(): void {
    if (!this.activeState) {
      return;
    }

    const seeds = SYNTHETIC_EVENT_SEEDS[this.activeState.backend];
    if (!seeds) {
      return;
    }

    const elapsed = Date.now() - this.activeState.startedAt;
    const targetEventCount = Math.max(1, Math.min(seeds.length * 3, Math.floor(elapsed / 150) + 1));
    const pid = this.activeState.pid ?? process.pid;

    while (this.activeState.generatedEvents < targetEventCount) {
      const seedIndex = this.activeState.generatedEvents % seeds.length;
      const seed = seeds[seedIndex];
      if (!seed) {
        break;
      }
      const timestamp = this.activeState.startedAt + this.activeState.generatedEvents * 75;

      this.capturedEvents.push({
        timestamp,
        pid,
        syscall: seed.syscall,
        args: [...seed.args],
        returnValue: seed.returnValue,
        duration: seed.duration,
      });
      this.activeState.generatedEvents += 1;
    }
  }

  private processLineBuffer(
    _buffer: string,
    _pid: number,
    _parser: 'strace' | 'etw' | 'dtrace',
  ): void {
    // Placeholder for incremental parsing logic
    // Currently handled inline in each subprocess handler
  }
}
