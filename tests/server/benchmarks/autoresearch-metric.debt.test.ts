/**
 * A-phase debt contract: `debt` penalizes ONLY missing SEMANTIC coverage.
 * Adding a refusal/contract case must NOT lower debt. Adding a real semantic
 * case must lower it by exactly 1. Legacy metric lines stay present.
 *
 * The metric extractor is a root-level .mjs; we import its pure `computeDebt`
 * helper so this test runs inside the vitest server project.
 */
import { describe, expect, it } from 'vitest';
import { computeDebt } from '../../../autoresearch-metric.mjs';

function fixture(over: Record<string, unknown> = {}) {
  const perTool = {
    stats: {
      total: 736,
      withVectors: 100,
      semanticCovered: 100,
      contractOnly: 0,
    },
    tools: [],
  };
  const suites = { results: [{ failed: 0, errored: 0 }] };
  const retrPerTool = {};
  const retrAgg = { pAt1: 0.7, mrrAt10: 0.8 };
  const rejection = { rejectionAccuracy: 1 };
  return { perTool, suites, retrPerTool, retrAgg, rejection, ...over };
}

describe('computeDebt (A: semantic-only debt)', () => {
  it('adding a contract-only case does NOT lower debt', () => {
    const base = computeDebt(fixture());
    const withContract = computeDebt(
      fixture({
        perTool: {
          stats: { total: 736, withVectors: 101, semanticCovered: 100, contractOnly: 1 },
          tools: [],
        },
      }),
    );
    expect(withContract.debt).toBe(base.debt);
    expect(withContract.contract_only).toBe(1);
  });

  it('adding a real semantic case lowers debt by exactly 1', () => {
    const base = computeDebt(fixture());
    const withSemantic = computeDebt(
      fixture({
        perTool: {
          stats: { total: 736, withVectors: 101, semanticCovered: 101, contractOnly: 0 },
          tools: [],
        },
      }),
    );
    expect(withSemantic.debt).toBe(base.debt - 1);
  });

  it('low_mrr and vector_fail still contribute', () => {
    const base = computeDebt(fixture());
    const worse = computeDebt(
      fixture({
        retrPerTool: { a: { mrr: 0.1 }, b: { mrr: 0.9 } },
        suites: { results: [{ failed: 2, errored: 1 }] },
      }),
    );
    expect(worse.low_mrr).toBe(1);
    expect(worse.vector_fail).toBe(3);
    expect(worse.debt).toBe(base.debt + 1 + 3);
  });

  it('derives TOTAL_TOOLS from stats.total, not a hardcoded literal', () => {
    const small = computeDebt(
      fixture({ perTool: { stats: { total: 10, semanticCovered: 8 }, tools: [] } }),
    );
    expect(small.unmeasured).toBe(2); // 10 - 8
  });

  it('emits semantic_covered and contract_only monitoring lines', () => {
    const m = computeDebt(fixture());
    expect(m.semantic_covered).toBe(100);
    expect(m.contract_only).toBe(0);
    expect(m).toHaveProperty('rejection_pct');
    expect(m).toHaveProperty('p1_pct');
  });
});
