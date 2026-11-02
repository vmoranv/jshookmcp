/**
 * Android logcat line parser + priority filtering.
 *
 * The default `adb logcat -v threadtime` format is:
 *   `03-14 12:34:56.789  1234  5678 I ActivityManager: Message text`
 * The capture layer (logcat.ts) returns raw lines; this parser lifts them into
 * structured {timestamp, pid, tid, priority, tag, message} records and supports
 * a min-priority filter (e.g. "only W/E/F") so analysts don't grep client-side.
 */
import type { LogcatLineFilter } from './logcat';

export type LogcatPriority = 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | 'S';

const PRIORITY_RANK: Record<LogcatPriority, number> = {
  V: 0,
  D: 1,
  I: 2,
  W: 3,
  E: 4,
  F: 5,
  S: 6,
};

export const ALL_PRIORITIES: readonly LogcatPriority[] = ['V', 'D', 'I', 'W', 'E', 'F', 'S'];

export interface ParsedLogcatLine {
  raw: string;
  timestamp?: string;
  pid?: number;
  tid?: number;
  priority?: LogcatPriority;
  tag?: string;
  message?: string;
}

// date time pid tid priority tag:message  (tag may contain spaces; message may be empty)
const THREADTIME_RE =
  /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+(.*?):\s?(.*)$/;

export function parseLogcatLine(raw: string): ParsedLogcatLine {
  const m = raw.match(THREADTIME_RE);
  if (!m) return { raw };
  return {
    raw,
    timestamp: m[1],
    pid: Number(m[2]),
    tid: Number(m[3]),
    priority: m[4] as LogcatPriority,
    tag: (m[5] ?? '').trim(),
    message: m[6] ?? '',
  };
}

/** Validate a user-supplied priority string into a LogcatPriority. */
export function parsePriorityArg(value: string | undefined): LogcatPriority | undefined {
  if (value === undefined) return undefined;
  const upper = value.trim().toUpperCase();
  if ((ALL_PRIORITIES as readonly string[]).includes(upper)) {
    return upper as LogcatPriority;
  }
  throw new Error(`Invalid minPriority "${value}". Expected one of: ${ALL_PRIORITIES.join(', ')}`);
}

/** True if a parsed line is at or above the minimum priority. Unparseable lines pass through. */
export function meetsMinPriority(line: ParsedLogcatLine, min: LogcatPriority): boolean {
  if (!line.priority) return true;
  return PRIORITY_RANK[line.priority] >= PRIORITY_RANK[min];
}

/**
 * Augment a raw-line filter with an optional minPriority: returns a predicate
 * usable from LogcatLineCollector's `predicate` slot.
 */
export function priorityPredicate(min: LogcatPriority): (line: string) => boolean {
  return (line) => meetsMinPriority(parseLogcatLine(line), min);
}

export type { LogcatLineFilter };
