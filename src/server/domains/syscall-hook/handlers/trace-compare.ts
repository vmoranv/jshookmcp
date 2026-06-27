/**
 * Syscall Trace Compare Handler — syscall_trace_compare
 *
 * Diffs two syscall trace snapshots to discover:
 *   - newly appeared syscalls (absent in baseline, present in target)
 *   - disappeared syscalls (present in baseline, absent in target)
 *   - frequency deltas per syscall name
 *
 * Useful for understanding what OS-level effect a specific JS operation has.
 */

import type { SyscallEvent } from '@modules/syscall-hook';
import { argNumber } from '@server/domains/shared/parse-args';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SyscallFreqDeltas {
  name: string;
  baselineCount: number;
  targetCount: number;
  delta: number;
  /** Whether the count change is statistically meaningful. */
  significance: 'high' | 'moderate' | 'low';
}

interface TraceCompareResult {
  success: boolean;
  error?: string;
  baselineCount: number;
  targetCount: number;
  appeared: SyscallEvent[];
  disappeared: SyscallEvent[];
  freqDeltas: SyscallFreqDeltas[];
  summary: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function syscallKey(e: SyscallEvent): string {
  return `${e.syscall}|${e.args.join('|')}|${e.returnValue ?? ''}`;
}

function buildFreqMap(events: SyscallEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of events) {
    map.set(e.syscall, (map.get(e.syscall) ?? 0) + 1);
  }
  return map;
}

function computeSignificance(baseline: number, target: number): SyscallFreqDeltas['significance'] {
  const delta = Math.abs(target - baseline);
  const total = baseline + target;
  if (total === 0) return 'low';
  const ratio = delta / total;
  if (ratio > 0.5 && delta >= 3) return 'high';
  if (ratio > 0.25 && delta >= 2) return 'moderate';
  return 'low';
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleSyscallTraceCompare(
  args: Record<string, unknown>,
  getBaseline: () => SyscallEvent[],
  getTarget: () => SyscallEvent[],
): Promise<TraceCompareResult> {
  const maxDeltas = argNumber(args, 'maxDeltas', 30);

  const baseline = getBaseline();
  const target = getTarget();

  const baselineKeySet = new Set(baseline.map(syscallKey));
  const targetKeySet = new Set(target.map(syscallKey));

  const appeared = target.filter((e) => !baselineKeySet.has(syscallKey(e)));
  const disappeared = baseline.filter((e) => !targetKeySet.has(syscallKey(e)));

  const baselineFreq = buildFreqMap(baseline);
  const targetFreq = buildFreqMap(target);

  const allNames = new Set([...baselineFreq.keys(), ...targetFreq.keys()]);

  const freqDeltas: SyscallFreqDeltas[] = [];
  for (const name of allNames) {
    const baselineCount = baselineFreq.get(name) ?? 0;
    const targetCount = targetFreq.get(name) ?? 0;
    if (baselineCount !== targetCount) {
      freqDeltas.push({
        name,
        baselineCount,
        targetCount,
        delta: targetCount - baselineCount,
        significance: computeSignificance(baselineCount, targetCount),
      });
    }
  }

  freqDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topDeltas = freqDeltas.slice(0, maxDeltas);

  const summaryParts: string[] = [];
  if (appeared.length > 0) summaryParts.push(`${appeared.length} new syscalls appeared`);
  if (disappeared.length > 0) summaryParts.push(`${disappeared.length} syscalls disappeared`);
  if (topDeltas.length > 0) {
    const sig = topDeltas.filter((d) => d.significance === 'high');
    if (sig.length > 0) summaryParts.push(`${sig.length} high-significance frequency changes`);
  }
  if (summaryParts.length === 0) summaryParts.push('no significant differences');

  return {
    success: true,
    baselineCount: baseline.length,
    targetCount: target.length,
    appeared,
    disappeared,
    freqDeltas: topDeltas,
    summary: summaryParts.join('; '),
  };
}
