/**
 * Phase 2.2: cross-view CLI PIPELINE (eval:trace -> trace-audit.json ->
 * eval:cross-view). Locks that provenance is printed and that fixture data is
 * explicitly labelled, never shown as if it were real agent traffic.
 *
 * Uses a pure renderCrossView with a meta param for the present/absent/malformed
 * paths; the CLI spawn is exercised end-to-end in the verify step.
 */
import { describe, expect, it } from 'vitest';
import { renderCrossView } from '../../../scripts/lib/eval-cross-view.mjs';

const l2 = {
  generatedAt: '2026-11-15T00:00:00.000Z',
  stats: { total: 736, semanticCovered: 630, contractOnly: 105 },
  tools: [{ tool: 'foo', domain: 'network', semantic: '1/1', contract: '—', holdoutMrr: '50.0%' }],
};
const combined = {
  repeatedToolCallRate: 0.0,
  orphanFailureCount: 0,
  p99CallDurationMs: 42.5,
  toolDiversity: 0.0556,
};

describe('cross-view pipeline: provenance (eval-trace-capture)', () => {
  it('present + fixture meta: prints source, labels fixture, still shows L0 numbers', () => {
    const { md, json } = renderCrossView(l2, combined, {
      sourceKind: 'fixture',
      sourceDir: 'D:/proj/.ccg/traces',
    });
    expect(json.traceAvailable).toBe(true);
    expect(json.sourceKind).toBe('fixture');
    expect(md).toContain('Trace source: `fixture`');
    expect(md).toContain('FIXTURE / selftest data');
    expect(md).toContain('NOT real agent traffic');
    expect(md).toContain('| 42.5 |'); // L0 value present, not hidden
  });

  it('present + live meta: no fixture warning', () => {
    const { md, json } = renderCrossView(l2, combined, {
      sourceKind: 'live',
      sourceDir: 'D:/live/traces',
    });
    expect(json.sourceKind).toBe('live');
    expect(md).toContain('Trace source: `live`');
    expect(md).not.toContain('FIXTURE / selftest data');
  });

  it('present + no meta: marks source unknown (never claims live)', () => {
    const { md, json } = renderCrossView(l2, combined);
    expect(json.sourceKind).toBe('unknown');
    expect(md).toContain('Trace source: `unknown`');
  });

  it('absent: no provenance lines, traceAvailable false, still degrades gracefully', () => {
    const { md, json } = renderCrossView(l2, null);
    expect(json.traceAvailable).toBe(false);
    expect(json.sourceKind).toBeNull();
    expect(md).not.toContain('Trace source:');
    expect(md).toContain('| — | — | — | — |');
  });

  it('malformed combined (null) behaves like absent, never throws', () => {
    const { json } = renderCrossView(l2, null, { sourceKind: 'fixture' });
    expect(json.traceAvailable).toBe(false);
    expect(json.debtDelta).toBe(0);
  });
});
