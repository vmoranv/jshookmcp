import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/constants', () => ({
  SEARCH_AFFINITY_BOOST_FACTOR: 0.5,
  SEARCH_AFFINITY_TOP_N: 2,
  SEARCH_DOMAIN_HUB_THRESHOLD: 2,
  SEARCH_AFFINITY_BASE_WEIGHT: 0.3,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER: 1.08,
}));

import { AffinityGraphImpl } from '@server/search/AffinityGraph';

describe('search/AffinityGraph', () => {
  beforeEach(() => {
    // Keep a stable test structure.
  });

  it('builds edges only for prefix groups between 2 and 15 members', () => {
    const graph = new AffinityGraphImpl([
      { name: 'breakpoint_code', domain: 'debugger' },
      { name: 'breakpoint_event', domain: 'debugger' },
      { name: 'lonely', domain: 'browser' },
      ...Array.from({ length: 16 }, (_, index) => ({
        name: `huge_${index}`,
        domain: 'huge',
      })),
    ]);

    expect(graph.getGraph().get(0)).toEqual([{ docIndex: 1, weight: expect.any(Number) }]);
    expect(graph.getGraph().get(1)).toEqual([{ docIndex: 0, weight: expect.any(Number) }]);
    expect(graph.getGraph().has(2)).toBe(false);
  });

  it('expands only already-relevant affinity neighbors', () => {
    const graph = new AffinityGraphImpl([
      { name: 'breakpoint_code', domain: 'debugger' },
      { name: 'breakpoint_event', domain: 'debugger' },
      { name: 'page_navigate', domain: 'browser' },
    ]);
    const scores = new Float64Array([10, 1, 0]);

    graph.applyAffinityExpansion(scores);

    expect(scores[1]).toBeGreaterThan(1);
    expect(scores[2]).toBe(0);
  });

  it('applies domain hub expansion only when a domain reaches the threshold', () => {
    const scores = new Float64Array([3, 2, 1, 4]);
    const domains = ['debugger', 'debugger', 'browser', 'browser'];

    AffinityGraphImpl.applyDomainHubExpansion(
      scores,
      scores.length,
      (index) => domains[index] ?? null,
    );

    expect(scores[0]).toBeCloseTo(3 * 1.08);
    expect(scores[1]).toBeCloseTo(2 * 1.08);
    expect(scores[2]).toBeCloseTo(1 * 1.08);
    expect(scores[3]).toBeCloseTo(4 * 1.08);
  });

  // ── Explicit cross-domain edges ──

  it('adds explicit cross-domain edges between tools', () => {
    const graph = new AffinityGraphImpl(
      [
        { name: 'intercept_fetch', domain: 'network' },
        { name: 'evaluate_js', domain: 'browser' },
        { name: 'breakpoint_code', domain: 'debugger' },
      ],
      [{ from: 'intercept_fetch', to: 'evaluate_js', relation: 'suggests', weight: 0.5 }],
    );

    const edges = graph.getGraph().get(0); // intercept_fetch
    expect(edges).toBeDefined();
    expect(edges!.some((e) => e.docIndex === 1 && e.weight === 0.5)).toBe(true);
  });

  it('merges explicit edges with prefix edges using max-weight', () => {
    const graph = new AffinityGraphImpl(
      [
        { name: 'breakpoint_code', domain: 'debugger' },
        { name: 'breakpoint_event', domain: 'debugger' },
      ],
      [
        // Explicit edge with higher weight than prefix would generate
        { from: 'breakpoint_code', to: 'breakpoint_event', relation: 'requires', weight: 0.9 },
      ],
    );

    const edges = graph.getGraph().get(0);
    expect(edges).toBeDefined();
    // Should use the higher weight (0.9 from explicit, not ~0.21 from prefix)
    const edgeTo1 = edges!.find((e) => e.docIndex === 1);
    expect(edgeTo1).toBeDefined();
    expect(edgeTo1!.weight).toBe(0.9);
  });

  it('ignores explicit edges referencing non-existent tools', () => {
    const graph = new AffinityGraphImpl(
      [{ name: 'tool_a', domain: 'core' }],
      [
        { from: 'tool_a', to: 'nonexistent_tool', relation: 'suggests', weight: 0.3 },
        { from: 'missing_tool', to: 'tool_a', relation: 'precedes', weight: 0.4 },
      ],
    );

    // No edges should be created for missing tools
    const edges = graph.getGraph().get(0);
    // tool_a has no prefix group and no valid explicit edges
    expect(edges ?? []).toEqual([]);
  });

  it('supports explicit edges without any prefix groups', () => {
    const graph = new AffinityGraphImpl(
      [
        { name: 'standalone', domain: 'core' },
        { name: 'another', domain: 'browser' },
      ],
      [{ from: 'standalone', to: 'another', relation: 'suggests', weight: 0.4 }],
    );

    const edges = graph.getGraph().get(0);
    expect(edges).toBeDefined();
    expect(edges!).toEqual([{ docIndex: 1, weight: 0.4 }]);
  });
});
