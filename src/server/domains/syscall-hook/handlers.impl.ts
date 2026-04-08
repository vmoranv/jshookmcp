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

function toLegacySyscallEvent(value: unknown): SyscallEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const syscallName = readString(value['syscallName']) ?? readString(value['syscall']);
  const pid = readNumber(value['pid']);
  const timestamp = readNumber(value['timestamp']);
  if (!syscallName || pid === undefined || timestamp === undefined) {
    return undefined;
  }

  return {
    syscall: syscallName,
    pid,
    timestamp,
    args: readStringArray(value['args']) ?? [],
    returnValue: readNumber(value['returnValue']),
    duration: readNumber(value['duration']),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown syscall-hook error';
}

export class SyscallHookHandlers {
  private readonly legacyRules: Array<{
    id: string;
    name: string;
    action: 'allow' | 'block' | 'log';
    matchPattern?: string;
    replacement?: string;
  }> = [];

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

  async handleMonitorStart(args: Record<string, unknown>): Promise<unknown> {
    const pid = readNumber(args['pid']);
    if (pid === undefined) {
      throw new Error('pid must be a number');
    }

    const maxEvents = readNumber(args['maxEvents']) ?? 1000;
    const sessionId = await this.ensureMonitor().startMonitor(pid, maxEvents);
    const platform =
      process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : 'darwin';

    return { sessionId, pid, platform };
  }

  async handleMonitorStop(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readString(args['sessionId']);
    if (!sessionId) {
      throw new Error('sessionId must be a non-empty string');
    }

    const eventCount = await this.ensureMonitor().stopMonitor(sessionId);
    return { sessionId, eventCount };
  }

  async handleEventsGet(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readString(args['sessionId']);
    if (!sessionId) {
      throw new Error('sessionId must be a non-empty string');
    }

    const filter = readString(args['filter']);
    const events = await this.ensureMonitor().getEvents(sessionId, filter);
    return { sessionId, events, eventCount: events.length };
  }

  async handleMapToJS(args: Record<string, unknown>): Promise<unknown> {
    const rawSyscallEvent = args['syscallEvent'];
    const jsStack = readStringArray(args['jsStack']) ?? [];

    let syscallEvent: SyscallEvent | undefined;
    if (isSyscallEvent(rawSyscallEvent)) {
      syscallEvent = rawSyscallEvent;
    } else {
      const legacySyscallEvent = toLegacySyscallEvent(rawSyscallEvent);
      if (legacySyscallEvent) {
        syscallEvent = legacySyscallEvent;
      } else {
        const sessionId = readString(args['sessionId']);
        const eventIndex = readNumber(args['eventIndex']);
        if (!sessionId || eventIndex === undefined) {
          throw new Error(
            'Either syscallEvent (object) or sessionId + eventIndex must be provided',
          );
        }

        const events = await this.ensureMonitor().getEvents(sessionId);
        syscallEvent = events[eventIndex];
        if (!syscallEvent) {
          throw new Error(`eventIndex ${eventIndex} out of range`);
        }
      }
    }

    const mapper = this.ensureMapper();
    const event = syscallEvent as SyscallEvent;
    const mapped = mapper.map(event);
    const confidence = mapped?.confidence ?? 0;
    const confidenceLabel =
      confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : confidence > 0 ? 'low' : 'none';

    return {
      syscall: event.syscall,
      jsFunction: mapped?.jsFunction,
      confidence,
      confidenceLabel,
      jsStack,
      reasoning: mapped?.reasoning ?? 'No correlation rule matched.',
    };
  }

  async handleFilterAdd(args: Record<string, unknown>): Promise<unknown> {
    const name = readString(args['name']);
    if (!name) {
      throw new Error('name must be a non-empty string');
    }

    const action = readString(args['action']);
    if (action !== 'allow' && action !== 'block' && action !== 'log') {
      throw new Error('action must be one of: allow, block, log');
    }

    const ruleId = `rule_${Math.random().toString(16).slice(2, 10)}`;
    this.legacyRules.push({
      id: ruleId,
      name,
      action,
      matchPattern: readString(args['matchPattern']),
      replacement: readString(args['replacement']),
    });

    return { ruleId };
  }

  async handleFilterList(): Promise<unknown> {
    return {
      ruleCount: this.legacyRules.length,
      rules: [...this.legacyRules],
    };
  }

  async handleFilterApply(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readString(args['sessionId']);
    if (!sessionId) {
      throw new Error('sessionId must be a non-empty string');
    }

    const events = await this.ensureMonitor().getEvents(sessionId);
    let allowedCount = 0;
    let blockedCount = 0;
    let loggedCount = 0;

    for (const event of events) {
      const matchedRule = this.legacyRules.find((rule) =>
        rule.matchPattern ? event.syscall.includes(rule.matchPattern) : true,
      );

      if (!matchedRule || matchedRule.action === 'allow') {
        allowedCount += 1;
        continue;
      }

      if (matchedRule.action === 'block') {
        blockedCount += 1;
        continue;
      }

      loggedCount += 1;
    }

    return {
      totalEvents: events.length,
      allowedCount,
      blockedCount,
      loggedCount,
    };
  }
}
