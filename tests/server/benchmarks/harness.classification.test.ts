/**
 * Locks that `runBenchSuite` resolves and carries the A-phase classification
 * onto every emitted BenchCaseResult, while preserving the existing scoring
 * semantics (score = passed/evaluated, skip excluded, STABLE/body intact).
 */
import { describe, expect, it } from 'vitest';
import { runBenchSuite, type BenchSuite, type BenchCase } from '@tests/benchmarks/harness';

function mkCase(over: Partial<BenchCase> = {}): BenchCase {
  return {
    name: 'c',
    tool: 'some_tool',
    origin: 'homemade',
    reference: 'unit',
    run: async () => ({ ok: true }),
    validate: () => true,
    ...over,
  };
}

describe('runBenchSuite classification propagation', () => {
  it('a default homemade case is resolved to semantic/smoke', async () => {
    const suite: BenchSuite = {
      name: 'unit',
      domain: 'unit',
      description: 'x',
      cases: [mkCase()],
    };
    const r = await runBenchSuite(suite);
    expect(r.cases[0]?.assertionKind).toBe('semantic');
    expect(r.cases[0]?.difficulty).toBe('smoke');
    expect(r.score).toBe(100);
  });

  it('an explicit contract case carries contract, adversarial origin is forced', async () => {
    const suite: BenchSuite = {
      name: 'unit',
      domain: 'unit',
      description: 'x',
      cases: [
        mkCase({ name: 'refusal', assertionKind: 'contract' }),
        mkCase({ name: 'neg', origin: 'adversarial' }),
      ],
    };
    const r = await runBenchSuite(suite);
    expect(r.cases[0]?.assertionKind).toBe('contract');
    expect(r.cases[1]?.assertionKind).toBe('adversarial');
    expect(r.cases[1]?.difficulty).toBe('adversarial');
  });

  it('skipped cases still carry classification and are excluded from score', async () => {
    const suite: BenchSuite = {
      name: 'unit',
      domain: 'unit',
      description: 'x',
      cases: [
        mkCase({ name: 'ok', assertionKind: 'semantic' }),
        mkCase({ name: 'skip', skip: () => true, skipReason: 'env' }),
      ],
    };
    const r = await runBenchSuite(suite);
    expect(r.cases[1]?.status).toBe('skipped');
    expect(r.cases[1]?.assertionKind).toBe('semantic');
    expect(r.skipped).toBe(1);
    expect(r.score).toBe(100); // 1 pass / 1 evaluated
  });
});
