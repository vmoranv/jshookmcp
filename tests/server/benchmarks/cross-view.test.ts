/**
 * C-phase: L2 capability × L0 trace cross-view. It is REPORT-ONLY, never a
 * correctness measurement, never a gate, never a composite score.
 *
 * Honest constraints locked here:
 *   - L0 trace metrics are WORKSPACE-WIDE (audit-tool-traces.mjs emits a
 *     `combined` object, not per-tool). We do NOT fabricate per-tool trace
 *     columns; they appear as workspace-level context.
 *   - trace absent => "—", no error, "no evidence != bad evidence".
 *   - a contradiction (semantic pass + high orphan failures) produces a SPIKE
 *     suggestion, never a verdict, and never changes debt.
 */
import { describe, expect, it } from 'vitest';
import { renderCrossView } from '../../../scripts/lib/eval-cross-view.mjs';

const l2 = {
  generatedAt: '2026-11-15T00:00:00.000Z',
  stats: { total: 736, semanticCovered: 630, contractOnly: 105 },
  tools: [
    { tool: 'foo', domain: 'network', semantic: '1/1', contract: '—', holdoutMrr: '50.0%' },
    { tool: 'bar', domain: 'browser', semantic: '—', contract: '1/1', holdoutMrr: '—' },
  ],
};

const l0Combined = {
  repeatedToolCallRate: 0.45,
  orphanFailureCount: 12,
  toolDiversity: 0.2,
  p99CallDurationMs: 9000,
  avgCallDurationMs: 120,
  planDepth: { max: 3 },
};

describe('renderCrossView (C: L0 x L2, report-only)', () => {
  it('carries the mandatory disclaimer header', () => {
    const { md } = renderCrossView(l2, null);
    expect(md).toContain('TRACE-DERIVED, NOT A CORRECTNESS MEASUREMENT');
    expect(md).toContain('Thresholds are uncalibrated');
    expect(md).toContain('Report-only');
    expect(md).toContain('No trace present');
  });

  it('trace absent => all L0 cells are "—", no throw, no bad-evidence verdict', () => {
    const { md, json } = renderCrossView(l2, null);
    expect(json.traceAvailable).toBe(false);
    expect(md).toContain('| — | — | — | — |');
    // The disclaimer legitimately contains the phrase "bad evidence"; what
    // must be absent is a *verdict* that the missing trace is bad evidence.
    expect(md).not.toMatch(/FAIL:|verdict:.*bad evidence|conclusion:.*bad evidence/i);
  });

  it('shows L2 per-tool rows alongside workspace-wide L0 context', () => {
    const { md } = renderCrossView(l2, l0Combined);
    expect(md).toContain('| foo | network | 1/1 | — | 50.0%');
    expect(md).toContain('repeated_tool_call_rate');
    expect(md).toContain('orphan_failure_count');
  });

  it('a contradiction suggests a spike, never a verdict, never affects debt', () => {
    const { md, json } = renderCrossView(l2, l0Combined);
    expect(json.signals.length).toBeGreaterThan(0);
    expect(json.signals[0]?.toLowerCase() ?? '').toMatch(/spike|case|investigat/);
    expect(md.toLowerCase()).not.toMatch(/tool (is )?(unqualified|failed|bad)/);
    expect(json.debtDelta).toBe(0); // cross-view never mutates debt
  });

  it('emits NO composite score / letter grade', () => {
    const { md } = renderCrossView(l2, l0Combined);
    // The declaration "no composite score" MUST be present; what is forbidden
    // is an actual emitted score/grade cell.
    expect(md).toContain('no composite score');
    expect(md).not.toMatch(/letter grade:|\| score:|\bgrade: [A-F]\b|Overall score/i);
  });
});
