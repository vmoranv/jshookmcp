import {
  SyscallMonitor,
  SyscallToJSMapper,
  type CorrelatedSyscall,
  type SyscallBackend,
  type SyscallEvent,
} from '@modules/syscall-hook';

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
  ) {}

  async handleSyscallStartMonitor(args: Record<string, unknown>): Promise<unknown> {
    const backend = readBackend(args['backend']);
    if (!backend) {
      return {
        ok: false,
        error: 'backend must be one of: etw, strace, dtrace',
      };
    }

    const pid = readNumber(args['pid']);
    if (args['pid'] !== undefined && pid === undefined) {
      return {
        ok: false,
        error: 'pid must be a finite number when provided',
      };
    }

    const monitor = this.ensureMonitor();
    try {
      await monitor.start({
        backend,
        pid,
      });
      return {
        ok: true,
        started: true,
        backend,
        pid,
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
