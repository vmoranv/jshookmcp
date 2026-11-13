/**
 * Unit coverage for the per-tool scorecard's stats derivation
 * (`statsFromSuiteResults`). Locks the two accounting rules the 2026-11-13
 * scorecard audit found violated by the previous re-execution approach:
 *
 *   1. env-gated `skipped` cases are NOT measurements — they must not enter
 *      the correctness denominator. Suite-level scoring already excludes them
 *      (harness.ts `evaluated` filter); the per-tool layer must agree.
 *   2. stats come from the gate's already-collected first-run results —
 *      re-executing suites inside per-tool-scorecard dirtied module-level-state
 *      suites (session ledger singleton, tls tmpdir keylog fixtures) and
 *      reported false failures on the second pass, plus it doubled gate time.
 */
import { describe, expect, it } from 'vitest';
import { statsFromSuiteResults } from '@tests/benchmarks/per-tool-scorecard.suite';
import type { BenchCaseResult, BenchSuiteResult } from '@tests/benchmarks/harness';

type CaseSpec = { tool: string; status: BenchCaseResult['status']; ms?: number };

function suiteResult(name: string, specs: CaseSpec[]): BenchSuiteResult {
  const cases: BenchCaseResult[] = specs.map((s, i) => ({
    name: `${name}/case-${i}`,
    tool: s.tool,
    origin: 'homemade',
    reference: 'unit-fixture',
    status: s.status,
    ms: s.ms ?? 1,
  }));
  return {
    suite: name,
    domain: 'unit',
    description: 'unit fixture suite',
    total: cases.length,
    passed: cases.filter((c) => c.status === 'pass').length,
    failed: cases.filter((c) => c.status === 'fail').length,
    errored: cases.filter((c) => c.status === 'error').length,
    skipped: cases.filter((c) => c.status === 'skipped').length,
    score: 100,
    durationMs: 0,
    cases,
  };
}

describe('statsFromSuiteResults', () => {
  it('excludes the audit suites (existing-tests-coverage, per-tool-scorecard)', () => {
    const stats = statsFromSuiteResults([
      suiteResult('existing-tests-coverage', [{ tool: 'foo_tool', status: 'pass' }]),
      suiteResult('per-tool-scorecard', [{ tool: 'bar_tool', status: 'pass' }]),
      suiteResult('encoding', [{ tool: 'baz_tool', status: 'pass' }]),
    ]);
    expect(stats.has('foo_tool')).toBe(false);
    expect(stats.has('bar_tool')).toBe(false);
    expect(stats.get('baz_tool')).toMatchObject({ passed: 1, total: 1 });
  });

  it('ignores aggregate pseudo-tools (tool names starting with "*")', () => {
    const stats = statsFromSuiteResults([
      suiteResult('per-tool-scorecard', [{ tool: '*all*', status: 'pass' }]),
    ]);
    expect(stats.size).toBe(0);
  });

  it('does not count skipped cases in the correctness denominator', () => {
    const stats = statsFromSuiteResults([
      suiteResult('browser', [
        { tool: 'page_session_storage', status: 'pass', ms: 2 },
        { tool: 'page_session_storage', status: 'skipped', ms: 0 },
      ]),
    ]);
    const s = stats.get('page_session_storage');
    expect(s).toBeDefined();
    expect(s?.total).toBe(1);
    expect(s?.passed).toBe(1);
    expect(s?.skipped).toBe(1);
    expect(s?.totalMs).toBe(2);
  });

  it('an all-skipped tool yields total 0 (scorecard renders "—")', () => {
    const stats = statsFromSuiteResults([
      suiteResult('adb-bridge', [{ tool: 'adb_dumpsys', status: 'skipped' }]),
    ]);
    const s = stats.get('adb_dumpsys');
    expect(s).toBeDefined();
    expect(s?.total).toBe(0);
    expect(s?.passed).toBe(0);
    expect(s?.skipped).toBe(1);
  });

  it('aggregates the same tool across suites and counts fails as non-pass', () => {
    const stats = statsFromSuiteResults([
      suiteResult('a', [{ tool: 't', status: 'pass', ms: 3 }]),
      suiteResult('b', [{ tool: 't', status: 'fail', ms: 4 }]),
      suiteResult('c', [{ tool: 't', status: 'pass', ms: 5 }]),
    ]);
    expect(stats.get('t')).toMatchObject({ passed: 2, total: 3, totalMs: 12, skipped: 0 });
  });
});
