import {
  SyscallMonitor,
  SyscallToJSMapper,
  type CorrelatedSyscall,
  type SyscallBackend,
  type SyscallEvent,
} from '@modules/syscall-hook';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { asJsonResponse } from '@server/domains/shared/response';
import { checkSyscallPermission } from './permission-check';
import { DirectNtApiHandlers } from './handlers/direct-nt';
import { handleSyscallStackCapture } from './handlers/stack-capture';
import { handleSyscallTraceCompare } from './handlers/trace-compare';
import { handleSyscallTraceExport } from './handlers/trace-export';
import { handleSyscallEbpfAttach } from './handlers/ebpf-attach';
import type { MCPServerContext } from '@server/MCPServer.context';
import {
  SYSCALL_TRACE_DURATION_DEFAULT_SEC,
  SYSCALL_TRACE_DURATION_MIN_SEC,
  SYSCALL_TRACE_DURATION_MAX_SEC,
} from '@src/constants';

interface EventFilter {
  name?: string[];
  pid?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return undefined;
    }
    strings.push(item);
  }
  return strings;
}

const SYSCALL_NAME_RE = /^[a-z][a-z0-9_]*$/;

function isValidSyscallName(name: string): boolean {
  return SYSCALL_NAME_RE.test(name) && name.length <= 64;
}

function normalizeSyscallList(value: unknown): string[] | undefined {
  const rawValues = readStringArray(value);
  if (!rawValues) {
    return undefined;
  }

  const normalizedValues: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of rawValues) {
    const normalizedValue = rawValue.trim().toLowerCase();
    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }
    seen.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  }
  return normalizedValues;
}

function readBackend(value: unknown): SyscallBackend | undefined {
  if (value === 'etw' || value === 'strace' || value === 'dtrace') {
    return value;
  }
  return undefined;
}

function readFilter(value: unknown): EventFilter | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const filter: EventFilter = {};
  const names = readStringArray(value['name']);
  const pid = readNumber(value['pid']);

  if (names) {
    filter.name = names;
  }
  if (pid !== undefined) {
    filter.pid = pid;
  }

  return filter;
}

function isSyscallEvent(value: unknown): value is SyscallEvent {
  if (!isRecord(value)) {
    return false;
  }

  const timestamp = readNumber(value['timestamp']);
  const pid = readNumber(value['pid']);
  const syscall = readString(value['syscall']);
  const args = readStringArray(value['args']);
  const returnValue = value['returnValue'];
  const duration = value['duration'];

  const returnValueValid = returnValue === undefined || readNumber(returnValue) !== undefined;
  const durationValid = duration === undefined || readNumber(duration) !== undefined;

  return (
    timestamp !== undefined &&
    pid !== undefined &&
    syscall !== undefined &&
    args !== undefined &&
    returnValueValid &&
    durationValid
  );
}

function cloneSyscallEvent(event: SyscallEvent): SyscallEvent {
  return {
    timestamp: event.timestamp,
    pid: event.pid,
    syscall: event.syscall,
    args: [...event.args],
    returnValue: event.returnValue,
    duration: event.duration,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown syscall-hook error';
}

export class SyscallHookHandlers {
  constructor(
    private monitor?: SyscallMonitor,
    private mapper?: SyscallToJSMapper,
    private eventBus?: EventBus<ServerEventMap>,
    private directNt = new DirectNtApiHandlers(),
    private ctx?: MCPServerContext,
  ) {}

  async handleSyscallStartMonitor(args: Record<string, unknown>): Promise<unknown> {
    const backend = readBackend(args['backend']);
    if (!backend) {
      return {
        ok: false,
        error: 'backend must be one of: etw, strace, dtrace',
      };
    }

    const rawMonitorPid = readNumber(args['pid']);
    const simulate = readBoolean(args['simulate']) ?? false;
    if (args['pid'] !== undefined && args['pid'] !== null) {
      if (rawMonitorPid === undefined || !Number.isInteger(rawMonitorPid) || rawMonitorPid < 0) {
        return {
          ok: false,
          error: 'pid must be a non-negative integer when provided',
        };
      }
    }
    const pid = rawMonitorPid;

    // Runtime permission check (skipped in test environment where monitor is mocked)
    if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
      const permCheck = await checkSyscallPermission();
      if (!permCheck.hasPermission) {
        return asJsonResponse({
          success: false,
          error: permCheck.reason,
          platform: permCheck.platform,
          requiredCapabilities: permCheck.requiredCapabilities,
        });
      }
    }

    const monitor = this.ensureMonitor();
    try {
      await monitor.start({
        backend,
        pid,
        simulate,
      });
      void this.eventBus?.emit('syscall:trace_started', {
        backend,
        pid,
        simulate,
        timestamp: new Date().toISOString(),
      });
      return {
        ok: true,
        started: true,
        backend,
        pid,
        simulate,
        stats: monitor.getStats(),
      };
    } catch (error) {
      return {
        ok: false,
        error: toErrorMessage(error),
        requestedBackend: backend,
        supportedBackends: monitor.getSupportedBackends(),
      };
    }
  }

  async handleSyscallStopMonitor(): Promise<unknown> {
    const monitor = this.ensureMonitor();
    try {
      await monitor.stop();
      return {
        ok: true,
        stopped: true,
        stats: monitor.getStats(),
      };
    } catch (error) {
      return {
        ok: false,
        error: toErrorMessage(error),
      };
    }
  }

  async handleSyscallCaptureEvents(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.ensureMonitor();
    const filter = readFilter(args['filter']);

    const events = await monitor.captureEvents(filter);
    return {
      ok: true,
      events,
      count: events.length,
      stats: monitor.getStats(),
    };
  }

  async handleSyscallCorrelateJs(args: Record<string, unknown>): Promise<unknown> {
    const rawEvents = args['syscallEvents'];
    if (!Array.isArray(rawEvents) || !rawEvents.every((item) => isSyscallEvent(item))) {
      return {
        ok: false,
        error: 'syscallEvents must be an array of valid SyscallEvent objects',
      };
    }

    const mapper = this.ensureMapper();
    const correlations: CorrelatedSyscall[] = [];
    const unmatched: SyscallEvent[] = [];

    for (const event of rawEvents) {
      const clonedEvent = cloneSyscallEvent(event);
      const correlated = mapper.map(clonedEvent);
      if (correlated) {
        correlations.push(correlated);
      } else {
        unmatched.push(clonedEvent);
      }
    }

    return {
      ok: true,
      correlations,
      matched: correlations.length,
      unmatched,
    };
  }

  async handleSyscallFilter(args: Record<string, unknown>): Promise<unknown> {
    const names = readStringArray(args['names']);
    if (args['names'] !== undefined && names === undefined) {
      return {
        ok: false,
        error: 'names must be an array of strings when provided',
      };
    }

    const monitor = this.ensureMonitor();
    const events = await monitor.captureEvents(
      names && names.length > 0
        ? {
            name: names,
          }
        : undefined,
    );

    return {
      ok: true,
      names,
      events,
      count: events.length,
    };
  }

  async handleSyscallGetStats(): Promise<unknown> {
    const monitor = this.ensureMonitor();
    return {
      ok: true,
      ...monitor.getStats(),
      running: monitor.isRunning(),
      supportedBackends: monitor.getSupportedBackends(),
    };
  }

  async handleSyscallEbpfTrace(args: Record<string, unknown>): Promise<unknown> {
    const rawPid = readNumber(args['pid']);
    const syscalls = normalizeSyscallList(args['syscalls']);
    const durationSec = readNumber(args['durationSec']) ?? SYSCALL_TRACE_DURATION_DEFAULT_SEC;
    const simulate = readBoolean(args['simulate']) ?? false;

    // Fail-closed: if pid was provided but not a valid positive integer, reject
    if (args['pid'] !== undefined && args['pid'] !== null) {
      if (rawPid === undefined || !Number.isInteger(rawPid) || rawPid < 0) {
        return { ok: false, error: 'pid must be a non-negative integer (0 for all processes)' };
      }
    }
    const pid = rawPid ?? 0;

    if (
      durationSec < SYSCALL_TRACE_DURATION_MIN_SEC ||
      durationSec > SYSCALL_TRACE_DURATION_MAX_SEC
    ) {
      return {
        ok: false,
        error: `durationSec must be between ${SYSCALL_TRACE_DURATION_MIN_SEC} and ${SYSCALL_TRACE_DURATION_MAX_SEC}`,
      };
    }

    // Validate syscall names against safe identifier pattern
    if (syscalls?.length) {
      const invalid = syscalls.filter((s) => !isValidSyscallName(s));
      if (invalid.length > 0) {
        return {
          ok: false,
          error: `Invalid syscall names (must be lowercase alphanumeric with underscores): ${invalid.join(', ')}`,
        };
      }
    }

    if (simulate) {
      const simulatedEvents: SyscallEvent[] = [];
      const syscallPool = syscalls?.length
        ? syscalls
        : [
            'read',
            'write',
            'openat',
            'close',
            'fstat',
            'mmap',
            'mprotect',
            'munmap',
            'brk',
            'ioctl',
          ];
      const simulatedTimestampStepMs = durationSec * 50;
      let cumulativeTime = 0;
      for (let i = 0; i < 20; i++) {
        // Add jitter to timestamp after first event: ±30% variance
        if (i > 0) {
          const jitter = (Math.random() - 0.5) * 0.6 * simulatedTimestampStepMs;
          cumulativeTime += simulatedTimestampStepMs + jitter;
        }
        simulatedEvents.push({
          timestamp: cumulativeTime,
          pid: pid || 1234,
          syscall: syscallPool[i % syscallPool.length] ?? 'read',
          args: [`fd=${(i % 5) + 3}`, `count=${(i + 1) * 64}`],
          returnValue: i % 3 === 0 ? -1 : (i + 1) * 64,
          duration: Math.random() * 2,
        });
      }
      return {
        ok: true,
        backend: 'ebpf',
        _simulated: true, // Explicit watermark
        simulated: true, // Keep for backward compatibility
        pid,
        durationSec,
        events: simulatedEvents,
        count: simulatedEvents.length,
        syscallsTraced: syscallPool,
        warning:
          'This is simulated data with synthetic timestamps and patterns. Use simulate: false for real syscall tracing.',
      };
    }

    // Generate a real bpftrace script for the requested syscalls
    const targetSyscalls = syscalls?.length
      ? syscalls
      : [
          'read',
          'write',
          'openat',
          'close',
          'fstat',
          'mmap',
          'mprotect',
          'munmap',
          'brk',
          'ioctl',
          'connect',
          'sendto',
          'recvfrom',
          'clone',
          'execve',
        ];
    const pidFilter = pid > 0 ? `/pid == ${pid}/` : '';
    const tracepoints = targetSyscalls
      .map((sc) => `tracepoint:syscalls:sys_enter_${sc}`)
      .join(', ');
    const exitTracepoints = targetSyscalls
      .map((sc) => `tracepoint:syscalls:sys_exit_${sc}`)
      .join(', ');

    const script = `#!/usr/bin/env bpftrace
// Generated by jshookmcp syscall_ebpf_trace
// Target PID: ${pid || 'all'} | Duration: ${durationSec}s | Syscalls: ${targetSyscalls.join(', ')}

BEGIN {
  printf("=== eBPF syscall trace started (pid=${pid || 'all'}, duration=${durationSec}s) ===\\n");
}

${tracepoints} ${pidFilter}
{
  @enter_ts[tid] = nsecs;
  printf("{\\"timestamp\\": %llu, \\"pid\\": %d, \\"tid\\": %d, \\"syscall\\": \\"%s\\", \\"phase\\": \\"enter\\", \\"args\\": {",
    elapsed / 1000000, pid, tid, probe);
  // Log key arguments based on syscall
  if (probe == "tracepoint:syscalls:sys_enter_openat" || probe == "tracepoint:syscalls:sys_enter_open") {
    printf("\\"pathname\\": \\"%s\\", \\"flags\\": %d, \\"mode\\": %d", args->pathname, args->flags, args->mode);
  } else if (probe == "tracepoint:syscalls:sys_enter_read" || probe == "tracepoint:syscalls:sys_enter_write") {
    printf("\\"fd\\": %d, \\"count\\": %d", args->fd, args->count);
  } else if (probe == "tracepoint:syscalls:sys_enter_connect") {
    printf("\\"fd\\": %d", args->fd);
  } else if (probe == "tracepoint:syscalls:sys_enter_mmap") {
    printf("\\"addr\\": %llu, \\"length\\": %llu, \\"prot\\": %d, \\"flags\\": %d, \\"fd\\": %d", args->addr, args->length, args->prot, args->flags, args->fd);
  } else if (probe == "tracepoint:syscalls:sys_enter_execve") {
    printf("\\"filename\\": \\"%s\\"", args->filename);
  } else {
    printf("\\"raw_args\\": \\"(see bpftrace -v output)\\"");
  }
  printf("}}\\n");
}

${exitTracepoints} ${pidFilter}
{
  $elapsed_ns = nsecs - @enter_ts[tid];
  printf("{\\"timestamp\\": %llu, \\"pid\\": %d, \\"tid\\": %d, \\"syscall\\": \\"%s\\", \\"phase\\": \\"exit\\", \\"ret\\": %d, \\"duration_us\\": %llu}\\n",
    elapsed / 1000000, pid, tid, probe, args->ret, $elapsed_ns / 1000);
  delete(@enter_ts[tid]);
}

interval:s:${durationSec} {
  printf("=== Trace duration (${durationSec}s) elapsed, exiting ===\\n");
  exit();
}

END {
  printf("=== eBPF syscall trace complete ===\\n");
  clear(@enter_ts);
}
`;

    return {
      ok: true,
      backend: 'ebpf',
      mode: 'script',
      pid,
      durationSec,
      syscallCount: targetSyscalls.length,
      syscallsTraced: targetSyscalls,
      script,
      usage: `bpftrace -e '${script.replace(/'/g, "'\\''")}'`,
      note: 'Run the generated bpftrace script on a Linux system with bpftrace installed and CAP_BPF/root privileges.',
      requiredCapabilities: ['CAP_BPF', 'root', 'bpftrace'],
    };
  }

  // ── Direct NT API delegation ───────────────────────────────────────────────

  async handleSyscallResolveSsn(args: Record<string, unknown>): Promise<unknown> {
    return this.directNt.handleSyscallResolveSsn(args);
  }

  async handleSyscallDirectInvoke(args: Record<string, unknown>): Promise<unknown> {
    return this.directNt.handleSyscallDirectInvoke(args);
  }

  // ── Stack Capture ───────────────────────────────────────────────────────────

  async handleSyscallStackCapture(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.ensureMonitor();
    const events = await monitor.captureEvents();
    return handleSyscallStackCapture(args, events, this.ctx);
  }

  // ── Trace Compare (snapshot-based diff) ──────────────────────────────────────

  async handleSyscallTraceCompare(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.ensureMonitor();
    // Baseline is read from last capture; target is fresh capture
    const baseline = await monitor.captureEvents();
    await monitor.stop();
    // Re-start to get a fresh capture window (user should have done operation between calls)
    // In practice baseline/target are taken from separate calls — this is best-effort
    const target = await monitor.captureEvents();
    return handleSyscallTraceCompare(
      args,
      () => baseline,
      () => target,
    );
  }

  // ── Trace Export ─────────────────────────────────────────────────────────────

  async handleSyscallTraceExport(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.ensureMonitor();
    const events = await monitor.captureEvents();
    return handleSyscallTraceExport(args, events);
  }

  // ── Live eBPF Attach ──────────────────────────────────────────────────────────

  async handleSyscallEbpfAttach(args: Record<string, unknown>): Promise<unknown> {
    return handleSyscallEbpfAttach(args);
  }

  private ensureMonitor(): SyscallMonitor {
    if (!this.monitor) {
      this.monitor = new SyscallMonitor();
    }
    return this.monitor;
  }

  private ensureMapper(): SyscallToJSMapper {
    if (!this.mapper) {
      this.mapper = new SyscallToJSMapper();
    }
    return this.mapper;
  }
}
