import type { ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { SYSCALL_TRACE_SPAWN_TIMEOUT_MS } from '@src/constants';
import { RingBuffer } from '@utils/RingBuffer';
import { readEnvBoolean } from '@src/config/environment';

export type SyscallBackend = 'etw' | 'strace' | 'dtrace' | 'adb';

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
  /** Optional ETW provider list to enable (Windows only). See ETW_PROVIDERS. */
  etwProviders?: string[];
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
  etwProviders?: string[];
}

interface SyntheticEventSeed {
  syscall: string;
  args: string[];
  returnValue?: number;
  duration?: number;
}

const SUPPORTED_BACKENDS: ReadonlyArray<SyscallBackend> = ['etw', 'strace', 'dtrace', 'adb'];

/**
 * Hard cap on retained syscall events. When the buffer is full the oldest
 * event is shifted out and counted in `droppedEvents` (surfaced via
 * getStats) so callers can detect silent loss instead of the process
 * growing without bound under sustained syscall traffic.
 */
export const MAX_CAPTURED_EVENTS = 100_000;

/**
 * Grace period between SIGTERM and SIGKILL when terminating a live tracer
 * subprocess on restart (start() while a session is active).
 */
export const SYSCALL_TRACE_KILL_GRACE_MS = 1_000;

/**
 * Named ETW kernel providers (Windows) beyond the legacy "NT Kernel Logger"
 * session. Each surfaces a class of events that the single `0x10000` flag masks:
 * Process lifecycle (with command line + exit code), network connect/sendto/
 * recvfrom, file CreateFile/Read/Write with full paths, and image (DLL) loads.
 * Surfaced via `syscall_start_monitor({ etwProviders })` and applied by
 * `captureWithETW` when the backend is `etw`.
 */
export const ETW_PROVIDERS: Readonly<Record<string, string>> = {
  'nt-kernel': 'NT Kernel Logger',
  'kernel-process': '{22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716}',
  'kernel-network': '{7dd42a49-5329-4832-8dfd-43d979153a88}',
  'kernel-file': '{edd08927-9cc4-4e65-b970-c2560fb5c289}',
  'kernel-image': '{65d92380-231d-4e56-8f6f-2e1e6e6e6e6e}',
};

/**
 * Descriptive catalog of the named ETW kernel providers, surfaced via
 * `syscall_get_stats` so tool callers can discover the valid `etwProviders`
 * names, their GUIDs, and what each provider actually surfaces — without
 * reading source. Order matches the `etwProviders` param documentation.
 */
export interface EtwProviderCatalogEntry {
  name: string;
  guid: string;
  description: string;
}

export const ETW_PROVIDER_CATALOG: ReadonlyArray<EtwProviderCatalogEntry> = [
  {
    name: 'nt-kernel',
    guid: ETW_PROVIDERS['nt-kernel']!,
    description:
      'Legacy "NT Kernel Logger" session with the Process + File I/O flag (0x10000). ' +
      'The default fallback when no providers are requested; surfaces a baseline ' +
      'mix of process and file events.',
  },
  {
    name: 'kernel-process',
    guid: ETW_PROVIDERS['kernel-process']!,
    description:
      'Process lifecycle events: ImageID/ProcessID create + exit with command line ' +
      'and exit code. Feeds the `process_spawn` pattern in syscall_pattern_detect.',
  },
  {
    name: 'kernel-network',
    guid: ETW_PROVIDERS['kernel-network']!,
    description:
      'Kernel network events: connect / sendto / recvfrom with local + remote ' +
      'addresses. Required for the `network_beacon` pattern on Windows.',
  },
  {
    name: 'kernel-file',
    guid: ETW_PROVIDERS['kernel-file']!,
    description:
      'File events: CreateFile / Read / Write / Close with full paths. Required ' +
      'for the `file_enum` pattern on Windows.',
  },
  {
    name: 'kernel-image',
    guid: ETW_PROVIDERS['kernel-image']!,
    description:
      'Image (DLL/EXE) load + unload events with full paths. Useful for tracking ' +
      'payload unpacking and dynamic module loading.',
  },
];

const SYNTHETIC_EVENT_SEEDS: Readonly<Record<SyscallBackend, ReadonlyArray<SyntheticEventSeed>>> = {
  // Android captures normally come from the adb/eBPF collector; these seeds only
  // back the explicit simulate=true path.
  adb: [
    {
      syscall: 'openat',
      args: ['/data/data/com.example/files/db', 'O_RDONLY'],
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
      syscall: 'connect',
      args: ['fd=55', 'AF_INET', 'port=443'],
      returnValue: 0,
      duration: 0.8,
    },
  ],
  etw: [
    {
      syscall: 'NtCreateFile',
      args: [path.join(os.tmpdir(), 'jshookmcp.log'), 'GENERIC_READ'],
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
  // Android capture is driven over adb (bpftrace on-device), so it is
  // host-platform independent; availability is checked at attach time.
  if (backend === 'adb') return true;
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

function createSpawnReadyGuard<TProcess extends ChildProcess>(
  label: string,
  resolve: (value: TProcess | PromiseLike<TProcess>) => void,
  reject: (reason?: unknown) => void,
  terminate?: () => void,
) {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) {
      return;
    }
    settled = true;
    // Best-effort kill: if terminate() throws (process already dead, platform
    // lacks the kill path), the timeout rejection below is the real signal.
    try {
      terminate?.();
    } catch {}
    reject(
      new Error(`${label} did not signal readiness within ${SYSCALL_TRACE_SPAWN_TIMEOUT_MS}ms`),
    );
  }, SYSCALL_TRACE_SPAWN_TIMEOUT_MS);

  return {
    resolveReady(process: TProcess) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(process);
    },
    rejectReady(error: Error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    },
  };
}

/**
 * Translate a requested ETW provider name list into logman `-p` argument pairs.
 * Unknown names are dropped; an empty/dropped list yields the legacy
 * single-provider session so existing behaviour is preserved.
 */
function buildEtwProviderArgs(requested: string[]): string[] {
  if (!requested || requested.length === 0) {
    return ['-p', ETW_PROVIDERS['nt-kernel']!, '0x10000'];
  }
  const args: string[] = [];
  for (const name of requested) {
    const resolved = ETW_PROVIDERS[name.toLowerCase()];
    if (resolved) {
      args.push('-p', resolved, '0xff');
    }
  }
  return args.length > 0 ? args : ['-p', ETW_PROVIDERS['nt-kernel']!, '0x10000'];
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
 * Fold a chunk into an incremental line buffer: complete lines are handed to
 * `onLine`, the unterminated tail is returned as the new buffer.
 */
function consumeLines(current: string, chunk: string, onLine: (line: string) => void): string {
  const lines = (current + chunk).split(/\r?\n/u);
  const remainder = lines.pop() ?? '';
  for (const line of lines) {
    if (line.length > 0) {
      onLine(line);
    }
  }
  return remainder;
}

/**
 * Parse a strace output line into a SyscallEvent.
 *
 * Example strace line:
 *   12345 14:30:00.123456 openat(AT_FDCWD, "/tmp/foo", O_RDONLY) = 3 <0.000123>
 */
function parseStraceLine(line: string, targetPid: number, startedAt: number): SyscallEvent | null {
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
    timestamp: Date.now() - startedAt,
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
function parseETWLine(line: string, targetPid: number, startedAt: number): SyscallEvent | null {
  const match = /^\[([^\]]+)\]\s+PID=(\d+)\s+(\w+)\s+(.*)$/u.exec(line.trim());
  if (!match) {
    return null;
  }

  const syscall = match[3] ?? 'unknown';
  const rawArgs = match[4] ?? '';
  const pid = Number(match[2]);

  const args = rawArgs.split(/\s+/u).filter((a) => a.length > 0);

  return {
    timestamp: Date.now() - startedAt,
    pid: Number.isFinite(pid) ? pid : targetPid,
    syscall,
    args,
  };
}

/**
 * Parse a dtrace output line.
 *
 * Supports both entry and return probes (see `captureWithDTrace` script). The
 * script emits the dtrace monotonic `timestamp` (ns since boot) on every probe;
 * when a `pendingEntries` map is supplied, entry probes buffer
 * `{ timestampNs, args }` keyed by `${pid}:${syscall}` and the matching return
 * probe emits a single SyscallEvent carrying `returnValue` and a `duration`
 * computed as `returnTimestamp - entryTimestamp`. Lines that do not match the
 * expected format are dropped (returns null).
 *
 * Example dtrace entry line:
 *   1234   0  5678  open_nocancel:entry  1234567000  /private/tmp/foo O_RDONLY
 * Example dtrace return line:
 *   1234   0  5678  open_nocancel:return  3  1234568000
 */
function parseDTraceLine(
  line: string,
  targetPid: number,
  startedAt: number,
  pendingEntries?: Map<string, { timestampNs: number; args: string[] }>,
): SyscallEvent | null {
  // Accept both `<cpu> <pid> ...` (dtrace's default prefix, one extra column)
  // and the raw `printf("%d %d %s...")` output (`<pid> <pid> ...`): the middle
  // numeric column is optional, and the last number before the probe name is
  // the pid.
  const match = /^\s*(\d+)\s+(?:\d+\s+)?(\d+)\s+(\w+):(entry|return)\s+(.*)$/u.exec(line.trim());
  if (!match) {
    return null;
  }

  const pid = Number(match[2]);
  const syscall = match[3] ?? 'unknown';
  const phase = match[4] ?? 'entry';
  const rest = match[5] ?? '';
  const resolvedPid = Number.isFinite(pid) ? pid : targetPid;
  const tail = rest.split(/\s+/u).filter((a) => a.length > 0);

  // Legacy callers that omit the map get the original entry-only behaviour:
  // emit immediately with args parsed from the tail.
  if (!pendingEntries) {
    return {
      timestamp: Date.now() - startedAt,
      pid: resolvedPid,
      syscall,
      args: tail,
    };
  }

  // Pairing mode: buffer entry probes, emit on matching return.
  if (phase === 'entry') {
    const entryTs = tail.length > 0 ? Number(tail[0]) : Number.NaN;
    pendingEntries.set(`${resolvedPid}:${syscall}`, {
      timestampNs: Number.isFinite(entryTs) ? entryTs : 0,
      args: tail.slice(1),
    });
    return null;
  }

  // Return probe: pair with the buffered entry (if any) to emit a richer event.
  const returnValueRaw = tail[0];
  const returnTsRaw = tail[1];
  const key = `${resolvedPid}:${syscall}`;
  const entry = pendingEntries.get(key);
  const returnValue = returnValueRaw !== undefined ? Number(returnValueRaw) : Number.NaN;

  if (entry) {
    pendingEntries.delete(key);
    const returnTs = returnTsRaw !== undefined ? Number(returnTsRaw) : Number.NaN;
    const durationNs = Number.isFinite(returnTs) ? returnTs - entry.timestampNs : Number.NaN;
    return {
      timestamp: Date.now() - startedAt,
      pid: resolvedPid,
      syscall,
      args: entry.args,
      returnValue: Number.isFinite(returnValue) ? returnValue : undefined,
      duration: Number.isFinite(durationNs) ? durationNs / 1_000_000 : undefined,
    };
  }

  // No matching entry — emit a best-effort return event with returnValue only.
  return {
    timestamp: Date.now() - startedAt,
    pid: resolvedPid,
    syscall,
    args: tail.slice(2),
    returnValue: Number.isFinite(returnValue) ? returnValue : undefined,
  };
}

export class SyscallMonitor {
  private activeState?: MonitorState;
  private readonly capturedEvents = new RingBuffer<SyscallEvent>(MAX_CAPTURED_EVENTS);
  private droppedEvents = 0;
  private lastBackend: SyscallBackend = chooseDefaultBackend();
  /** True when events were ingested from an external collector (adb/eBPF). */
  private externalIngest = false;
  private subprocessError?: string;
  /**
   * In-buffer pairing of dtrace entry/return probes keyed by `${pid}:${syscall}`.
   * Populated only during dtrace capture; an entry records the dtrace monotonic
   * `timestamp` (ns since boot) and the args copied from `arg0` so the matching
   * return probe can compute `duration` (returnTs − entryTs) and capture
   * `returnValue`.
   */
  private readonly dtracePendingEntries = new Map<
    string,
    { timestampNs: number; args: string[] }
  >();

  async start(options?: StartOptions): Promise<void> {
    const requestedBackend = options?.backend ?? chooseDefaultBackend();
    const startedAt = Date.now();
    this.externalIngest = false;

    if (!isBackendSupportedOnCurrentPlatform(requestedBackend)) {
      throw new Error(
        `Backend "${requestedBackend}" is not available on platform "${process.platform}"`,
      );
    }

    // Restart semantics: a replacement session must not orphan the previous
    // tracer subprocess — terminate it before any new capture is spawned.
    if (this.activeState?.subprocess) {
      await this.terminateSubprocess(this.activeState.subprocess);
    }

    // If --simulate flag or JSHOOK_SIMULATE=1, use synthetic mode
    const simulate = options?.simulate ?? readEnvBoolean('JSHOOK_SIMULATE', false);
    if (simulate) {
      this.activeState = {
        backend: requestedBackend,
        pid: options?.pid,
        startedAt,
        generatedEvents: 0,
        etwProviders: requestedBackend === 'etw' ? options?.etwProviders : undefined,
      };
      this.lastBackend = requestedBackend;
      this.resetCapture();
      this.generateSyntheticEvents();
      return;
    }

    // Attempt real subprocess capture
    const pid = options?.pid ?? process.pid;
    let subprocess: ChildProcess | undefined;

    try {
      if (requestedBackend === 'strace') {
        subprocess = await this.captureWithStrace(pid, startedAt);
      } else if (requestedBackend === 'etw') {
        subprocess = await this.captureWithETW(pid, startedAt);
      } else if (requestedBackend === 'dtrace') {
        subprocess = await this.captureWithDTrace(pid, startedAt);
      }
    } catch (error) {
      this.subprocessError = error instanceof Error ? error.message : String(error);
      // Fall back to simulation if subprocess fails
      this.activeState = {
        backend: requestedBackend,
        pid: options?.pid,
        startedAt,
        generatedEvents: 0,
        etwProviders: requestedBackend === 'etw' ? options?.etwProviders : undefined,
      };
      this.lastBackend = requestedBackend;
      this.resetCapture();
      this.generateSyntheticEvents();
      return;
    }

    this.activeState = {
      backend: requestedBackend,
      pid: options?.pid,
      startedAt,
      generatedEvents: 0,
      subprocess,
      etwProviders: requestedBackend === 'etw' ? options?.etwProviders : undefined,
    };
    this.lastBackend = requestedBackend;
    this.resetCapture();
    this.subprocessError = undefined;
  }

  async stop(): Promise<void> {
    this.externalIngest = false;
    if (this.activeState?.subprocess) {
      this.activeState.subprocess.kill('SIGTERM');
      this.activeState.subprocess = undefined;
    }
    this.activeState = undefined;
  }

  /**
   * Ingest events captured by an external collector (e.g. `syscall_ebpf_attach`
   * over adb). Marks the session active so `syscall_capture_events`, filters and
   * stats operate on the same buffer as native backends, without a host
   * subprocess (and without the synthetic-event regeneration path).
   */
  ingestExternal(backend: SyscallBackend, events: readonly SyscallEvent[], pid?: number): void {
    this.externalIngest = true;
    this.lastBackend = backend;
    this.activeState = {
      backend,
      pid,
      startedAt: Date.now(),
      generatedEvents: events.length,
    };
    this.subprocessError = undefined;
    this.resetCapture();
    for (const event of events) this.pushCapturedEvent(event);
  }

  async captureEvents(filter?: CaptureFilter): Promise<SyscallEvent[]> {
    if (this.activeState && !this.activeState.subprocess && !this.externalIngest) {
      this.generateSyntheticEvents();
    }

    return this.capturedEvents
      .toArray()
      .filter((event) => matchesFilter(event, filter))
      .map(cloneEvent);
  }

  getStats(): {
    eventsCaptured: number;
    /** Events dropped because the buffer hit {@link MAX_CAPTURED_EVENTS}. */
    droppedEvents: number;
    uptime: number;
    backend: SyscallBackend;
    subprocessActive: boolean;
    subprocessError?: string;
    /** Active session config — present only while a session is running. */
    pid?: number;
    simulate?: boolean;
    etwProviders?: string[];
  } {
    const backend = this.activeState?.backend ?? this.lastBackend;
    const uptime = this.activeState ? Date.now() - this.activeState.startedAt : 0;
    const state = this.activeState;
    return {
      eventsCaptured: this.capturedEvents.length,
      droppedEvents: this.droppedEvents,
      uptime,
      backend,
      subprocessActive: !!state?.subprocess,
      subprocessError: this.subprocessError,
      // Session-config introspection (undefined when no active session).
      // `simulate` is true for synthetic mode (no live subprocess); when a real
      // subprocess is attached the session is live.
      ...(state
        ? {
            pid: state.pid,
            simulate: this.externalIngest ? false : !state.subprocess,
            ...(state.etwProviders ? { etwProviders: state.etwProviders } : {}),
          }
        : {}),
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
  async captureWithStrace(
    pid: number,
    startedAt = this.activeState?.startedAt ?? Date.now(),
  ): Promise<ChildProcess> {
    const { spawn } = await import('node:child_process');

    return new Promise<ChildProcess>((resolve, reject) => {
      const subprocess = spawn(
        'strace',
        ['-p', String(pid), '-f', '-yy', '-X', 'verbose', '-e', 'trace=all', '-t'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const ready = createSpawnReadyGuard('strace process', resolve, reject, () =>
        subprocess.kill('SIGTERM'),
      );

      let stdoutBuffer = '';
      let stderrBuffer = '';
      const handleLine = (line: string) => {
        const event = parseStraceLine(line, pid, startedAt);
        if (event) {
          this.pushCapturedEvent(event);
        }
      };

      // strace normally writes trace lines to stderr, but some wrappers and
      // strace variants emit on stdout — both streams are parsed so stdout
      // output is captured instead of accumulating unbounded in a dead buffer.
      subprocess.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer = consumeLines(stdoutBuffer, chunk.toString(), handleLine);
      });

      subprocess.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer = consumeLines(stderrBuffer, chunk.toString(), handleLine);
      });

      subprocess.on('error', (error: Error) => {
        ready.rejectReady(
          new Error(`strace process error: ${error.message}. Is strace installed?`),
        );
      });

      subprocess.on('spawn', () => {
        ready.resolveReady(subprocess);
      });
    });
  }

  /**
   * Spawn ETW tracing on Windows using logman.
   * Parses ETW trace output into SyscallEvent objects.
   */
  async captureWithETW(
    pid: number,
    startedAt = this.activeState?.startedAt ?? Date.now(),
  ): Promise<ChildProcess> {
    const { spawn } = await import('node:child_process');

    return new Promise<ChildProcess>((resolve, reject) => {
      const sessionName = `JSHookETW_${pid}`;
      const requestedProviders = this.activeState?.etwProviders ?? [];
      // Build the logman provider list. When callers request named providers
      // (kernel-process / kernel-network / kernel-file / kernel-image) we emit
      // one `-p <guid>` per provider; otherwise fall back to the legacy single
      // "NT Kernel Logger" session with the Process/File I/O flag (0x10000).
      const providerArgs = buildEtwProviderArgs(requestedProviders);

      const logman = spawn(
        'logman',
        ['create', 'trace', sessionName, ...providerArgs, '-o', `jshook_etw_${pid}.etl`, '-ets'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      const ready = createSpawnReadyGuard('ETW trace session', resolve, reject, () =>
        logman.kill('SIGTERM'),
      );

      let outputBuffer = '';

      logman.stdout?.on('data', (chunk: Buffer) => {
        outputBuffer += chunk.toString();
        const lines = outputBuffer.split(/\r?\n/u);
        outputBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const event = parseETWLine(line, pid, startedAt);
          if (event) {
            this.pushCapturedEvent(event);
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
        ready.rejectReady(new Error(`ETW trace error: ${error.message}. Run as Administrator.`));
      });

      logman.on('exit', (code) => {
        if (code !== 0 && code !== undefined) {
          // logman exits after trace is stopped; non-zero is expected
          ready.rejectReady(
            new Error(`ETW trace session ended (code ${code}). Check permissions.`),
          );
        }
      });

      logman.on('spawn', () => {
        ready.resolveReady(logman);
      });
    });
  }

  /**
   * Spawn dtrace for syscall tracing on macOS.
   * Parses dtrace output into SyscallEvent objects.
   */
  async captureWithDTrace(
    pid: number,
    startedAt = this.activeState?.startedAt ?? Date.now(),
  ): Promise<ChildProcess> {
    const { spawn } = await import('node:child_process');

    return new Promise<ChildProcess>((resolve, reject) => {
      // Attach both entry and return probes so we can capture `returnValue` and
      // `duration` for darwin events. Each probe emits the dtrace monotonic
      // `timestamp` (ns since boot) so the entry/return pairing can compute a
      // duration delta; the entry probe also copies arg0 (the first syscall
      // argument) for the args array, and the return probe emits arg1 (the
      // numeric return value). Pairing is done in `parseDTraceLine` via the
      // `dtracePendingEntries` buffer.
      const script = `
        syscall:::entry
        /pid == ${pid}/
        {
          printf("%d %d %s:entry %d %s\\n", pid, pid, probefunc, timestamp, copyinstr(arg0));
        }
        syscall:::return
        /pid == ${pid}/
        {
          printf("%d %d %s:return %d %d\\n", pid, pid, probefunc, arg1, timestamp);
        }
      `;

      const dtrace = spawn('dtrace', ['-n', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const ready = createSpawnReadyGuard('dtrace process', resolve, reject, () =>
        dtrace.kill('SIGTERM'),
      );

      let outputBuffer = '';

      dtrace.stdout?.on('data', (chunk: Buffer) => {
        outputBuffer += chunk.toString();
        const lines = outputBuffer.split(/\r?\n/u);
        outputBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const event = parseDTraceLine(line, pid, startedAt, this.dtracePendingEntries);
          if (event) {
            this.pushCapturedEvent(event);
          }
        }
      });

      dtrace.stderr?.on('data', () => {
        // dtrace outputs header info to stderr; ignore
      });

      dtrace.on('error', (error: Error) => {
        ready.rejectReady(new Error(`dtrace error: ${error.message}. Run with sudo.`));
      });

      dtrace.on('spawn', () => {
        ready.resolveReady(dtrace);
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
      const timestamp = this.activeState.generatedEvents * 75;

      this.pushCapturedEvent({
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

  /**
   * Append an event while enforcing the {@link MAX_CAPTURED_EVENTS} ring cap:
   * beyond the cap the oldest event is overwritten (O(1) ring-buffer drop) and
   * counted in `droppedEvents` (surfaced via getStats) so silent loss stays
   * visible.
   */
  private pushCapturedEvent(event: SyscallEvent): void {
    if (this.capturedEvents.length >= MAX_CAPTURED_EVENTS) {
      this.droppedEvents += 1;
    }
    this.capturedEvents.push(event);
  }

  /** Clear retained events and the drop counter for a fresh session. */
  private resetCapture(): void {
    this.capturedEvents.clear();
    this.droppedEvents = 0;
  }

  /**
   * Terminate a live tracer subprocess before replacing it: SIGTERM first,
   * escalating to SIGKILL after {@link SYSCALL_TRACE_KILL_GRACE_MS} if it has
   * not exited. Returns immediately when the process already exited or the
   * SIGTERM delivery itself failed.
   */
  private async terminateSubprocess(subprocess: ChildProcess): Promise<void> {
    if (subprocess.exitCode !== null || subprocess.signalCode !== null) {
      return;
    }
    if (!subprocess.kill('SIGTERM')) {
      return;
    }
    await new Promise<void>((resolve) => {
      const graceTimer = setTimeout(() => {
        subprocess.kill('SIGKILL');
        resolve();
      }, SYSCALL_TRACE_KILL_GRACE_MS);
      subprocess.once('exit', () => {
        clearTimeout(graceTimer);
        resolve();
      });
    });
  }
}
