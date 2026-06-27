/**
 * Syscall Trace Export Handler — syscall_trace_export
 *
 * Exports captured syscall events to portable NDJSON format
 * with optional time-range filtering and deduplication.
 */

import type { SyscallEvent } from '@modules/syscall-hook';
import { argNumber, argBool } from '@server/domains/shared/parse-args';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TraceExportResult {
  success: boolean;
  error?: string;
  events: SyscallEvent[];
  eventCount: number;
  totalCaptured: number;
  filteredOut: number;
  deduplicatedOut: number;
  filters: {
    minTimestamp?: number;
    maxTimestamp?: number;
    deduplicate: boolean;
    dedupWindowMs?: number;
  };
  /** Full NDJSON string — may be large. */
  ndjson?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function syscallFingerprint(e: SyscallEvent): string {
  return `${e.syscall}|${e.args.join('|')}|${e.returnValue ?? ''}|${e.pid}`;
}

function deduplicateWithinWindow(events: SyscallEvent[], windowMs: number): SyscallEvent[] {
  if (events.length === 0) return [];
  const result: SyscallEvent[] = [events[0]!];
  const seen = new Map<string, number>(); // fingerprint → last seen timestamp
  seen.set(syscallFingerprint(events[0]!), events[0]!.timestamp);

  for (let i = 1; i < events.length; i++) {
    const event = events[i]!;
    const fp = syscallFingerprint(event);
    const lastSeen = seen.get(fp);

    if (lastSeen !== undefined && event.timestamp - lastSeen < windowMs) {
      // Duplicate within window — skip
      continue;
    }

    seen.set(fp, event.timestamp);
    result.push(event);
  }

  return result;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleSyscallTraceExport(
  args: Record<string, unknown>,
  capturedEvents: SyscallEvent[],
): Promise<TraceExportResult> {
  const minTimestamp = argNumber(args, 'minTimestamp', 0);
  const maxTimestamp = argNumber(args, 'maxTimestamp', 0);
  const deduplicate = argBool(args, 'deduplicate', false);
  const dedupWindowMs = argNumber(args, 'dedupWindowMs', 100);
  const includeNdjson = argBool(args, 'includeNdjson', true);

  const totalCaptured = capturedEvents.length;
  let filtered = [...capturedEvents];
  let filteredOut = 0;

  // Time range filter
  if (minTimestamp > 0 || maxTimestamp > 0) {
    const before = filtered.length;
    filtered = filtered.filter((e) => {
      if (minTimestamp > 0 && e.timestamp < minTimestamp) return false;
      if (maxTimestamp > 0 && e.timestamp > maxTimestamp) return false;
      return true;
    });
    filteredOut = before - filtered.length;
  }

  // Deduplication
  let deduplicatedOut = 0;
  if (deduplicate) {
    const before = filtered.length;
    filtered = deduplicateWithinWindow(filtered, dedupWindowMs);
    deduplicatedOut = before - filtered.length;
  }

  const result: TraceExportResult = {
    success: true,
    events: filtered.slice(0, 10000), // Cap at 10k for context safety
    eventCount: filtered.length,
    totalCaptured,
    filteredOut,
    deduplicatedOut,
    filters: {
      minTimestamp: minTimestamp > 0 ? minTimestamp : undefined,
      maxTimestamp: maxTimestamp > 0 ? maxTimestamp : undefined,
      deduplicate,
      ...(deduplicate ? { dedupWindowMs } : {}),
    },
  };

  if (includeNdjson && filtered.length > 0) {
    result.ndjson = filtered
      .slice(0, 5000) // NDJSON cap
      .map((e) => JSON.stringify(e))
      .join('\n');
  }

  return result;
}
