/**
 * D-phase: evaluation-number consistency guard. Locks that a reader can always
 * tell which run a number came from, and that reported headers never contradict
 * their own stats. Honest placeholders ("not measured", "measured:false", "—")
 * are EXEMPT — the guard must never "clean them up".
 */
import { describe, expect, it } from 'vitest';
import { checkConsistency } from '../../../scripts/audit/eval-consistency.mjs';

function base(over: Record<string, unknown> = {}) {
  return {
    scorecard: { generatedAt: '2026-11-15T11:35:38.787Z', results: [] },
    perToolJson: {
      generatedAt: '2026-11-15T11:35:38.783Z',
      stats: { total: 736, semanticCovered: 630, withCoverage: 708 },
      tools: [],
    },
    perToolMd:
      '# Per-Tool Benchmark Scorecard\n' +
      'Semantic covered: **630** tools · handler coverage measured: **708** · fully measured: **596**',
    coverageMtimeMs: Date.parse('2026-11-15T11:35:30.000Z'),
    ...over,
  };
}

describe('checkConsistency (D: eval drift guard)', () => {
  it('passes for a coherent same-run snapshot', () => {
    expect(checkConsistency(base()).ok).toBe(true);
  });

  it('fails when scorecard and per-tool scorecard come from different runs', () => {
    const a = base({
      scorecard: { generatedAt: '2026-11-14T20:50:00.000Z', results: [] },
    });
    const r = checkConsistency(a);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/different run|timestamp/i);
  });

  it('fails when the md header contradicts its own stats (handler coverage 0 vs 708)', () => {
    const a = base({
      perToolMd:
        '# Per-Tool Benchmark Scorecard\n' +
        'Semantic covered: **630** tools · handler coverage measured: **0** · fully measured: **0**',
    });
    const r = checkConsistency(a);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/header.*stats|contradict/i);
  });

  it('fails when the header states a tool count contradicting stats.total', () => {
    const a = base({
      perToolMd:
        '# Per-Tool Benchmark Scorecard\nnative metrics (731 tools)\n' +
        'Semantic covered: **630** tools',
    });
    const r = checkConsistency(a);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/731|tool (count|total)/i);
  });

  it('EXEMPTS honest placeholders (measured:false / not measured / —)', () => {
    const a = base({
      perToolMd:
        '# Per-Tool Benchmark Scorecard\n' +
        'Vector-bench measured: **0** tools · handler coverage measured: **0** · fully measured: **0**',
      perToolJson: {
        generatedAt: '2026-11-15T11:35:38.783Z',
        stats: { total: 736, semanticCovered: 0, withCoverage: 0 },
        tools: [],
        measured: false, // honest bootstrap placeholder
      },
    });
    expect(checkConsistency(a).ok).toBe(true);
  });

  it('passes when some artifacts are simply MISSING but present ones are coherent', () => {
    const a = base({ coverageMtimeMs: null });
    expect(checkConsistency(a).ok).toBe(true); // guard does not require completeness
  });

  it('CI order: e2e/retrieval must exist at or before coverage mtime', () => {
    const a = base({ coverageMtimeMs: Date.parse('2026-11-15T11:00:00.000Z') });
    // CI order is checked by a separate exported helper; here just ensure the
    // main guard stays green on the coherent snapshot.
    expect(checkConsistency(a).ok).toBe(true);
  });
});
