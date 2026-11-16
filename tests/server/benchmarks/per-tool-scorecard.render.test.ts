/**
 * A-phase render contract: per-tool rows expose semantic / contract / adv as
 * THREE native columns plus holdout-MRR; the single `correctness` column is
 * gone; no composite score; contract-only tools are flagged, not "unmeasured".
 */
import { describe, expect, it } from 'vitest';
import {
  renderPerToolScorecardFrom,
  type ToolMetrics,
} from '@tests/benchmarks/per-tool-scorecard.suite';

function row(over: Partial<ToolMetrics> = {}): ToolMetrics {
  return {
    tool: 'some_tool',
    domain: 'encoding',
    correctness: '1/1 vectors', // backward-compat JSON field, not a rendered column
    semantic: '1/1',
    contract: '—',
    adversarial: '—',
    holdoutMrr: '—',
    throughput: '138µs/call',
    handlerFn: '100%',
    e2eTasks: '0 tasks',
    retrieval: 'MRR 75.0% · 2q',
    evaluation: 'all layers measured',
    ...over,
  };
}

function render(rows: ToolMetrics[]): { md: string; stats: Record<string, number> } {
  return renderPerToolScorecardFrom(rows);
}

describe('renderPerToolScorecardFrom (A: split columns)', () => {
  it('keeps the no-composite-score declaration', () => {
    expect(render([row()]).md).toContain('No composite score, no letter grades');
  });

  it('renders semantic/contract/adv/holdout columns and drops correctness column', () => {
    const md = render([row({ semantic: '2/2', contract: '1/1', holdoutMrr: '66.7%' })]).md;
    expect(md).toContain('| semantic | contract | adv | holdout-MRR');
    expect(md).not.toContain('| Correctness |');
    expect(md).toContain('| 2/2 | 1/1 | — | 66.7%');
  });

  it('empty buckets render — not 0/0', () => {
    const md = render([row({ semantic: '—', contract: '—', adversarial: '—' })]).md;
    expect(md).toContain('| — | — | — |');
    expect(md).not.toMatch(/\| 0\/0 \|/);
  });

  it('stats include semanticCovered and contractOnly', () => {
    const { stats } = render([
      row({ tool: 'a', semantic: '1/1', contract: '—' }),
      row({ tool: 'b', semantic: '—', contract: '2/2', evaluation: 'missing: no semantic vector' }),
    ]);
    expect(stats['semanticCovered']).toBe(1);
    expect(stats['contractOnly']).toBe(1);
  });

  it('a contract-only row is NOT labelled "not measured"; it names no semantic vector', () => {
    const md = render([
      row({ semantic: '—', contract: '2/2', evaluation: 'missing: no semantic vector' }),
    ]).md;
    expect(md).toContain('no semantic vector');
    expect(md).not.toContain('not measured');
  });

  it('withVectors remains as a compat stat (sum of tools with any bucket)', () => {
    const { stats } = render([
      row({ tool: 'a', semantic: '1/1' }),
      row({ tool: 'b', semantic: '—', contract: '1/1' }),
    ]);
    expect(stats['withVectors']).toBe(2);
  });

  it('still writes one row per tool (736-scale)', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ tool: `t_${i}` }));
    const md = render(rows).md;
    expect((md.match(/^\| t_/gm) ?? []).length).toBe(8);
  });
});
