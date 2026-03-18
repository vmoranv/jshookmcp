import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/constants', () => ({
  SEARCH_AFFINITY_BOOST_FACTOR: 0.5,
  SEARCH_AFFINITY_TOP_N: 2,
  SEARCH_DOMAIN_HUB_THRESHOLD: 2,
}));

import { AffinityGraphImpl } from '@server/search/AffinityGraph';

describe('search/AffinityGraph', () => {
  beforeEach(() => {
    // Keep a stable test structure.
  });

  it('builds edges only for prefix groups between 2 and 15 members', () => {
    const graph = new AffinityGraphImpl([
      { name: 'breakpoint_set', domain: 'debugger' },
      { name: 'breakpoint_remove', domain: 'debugger' },
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
      { name: 'breakpoint_set', domain: 'debugger' },
      { name: 'breakpoint_remove', domain: 'debugger' },
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
      (index) => domains[index] ?? null
    );

    expect(scores[0]).toBeCloseTo(3 * 1.08);
    expect(scores[1]).toBeCloseTo(2 * 1.08);
    expect(scores[2]).toBeCloseTo(1 * 1.08);
    expect(scores[3]).toBeCloseTo(4 * 1.08);
  });
});
