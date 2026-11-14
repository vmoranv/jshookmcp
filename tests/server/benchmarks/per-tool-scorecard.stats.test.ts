/**
 * Unit coverage for the per-tool scorecard's stats derivation
 * (`statsFromSuiteResults`) and its coverage→handler mapping
 * (`summarizeHandlerFn`). Locks the accounting rules the 2026-11-13
 * scorecard audit found violated by the previous re-execution approach:
 *
 *   1. env-gated `skipped` cases are NOT measurements — they must not enter
 *      the correctness denominator. Suite-level scoring already excludes them
 *      (harness.ts `evaluated` filter); the per-tool layer must agree.
 *   2. stats come from the gate's already-collected first-run results —
 *      re-executing suites inside per-tool-scorecard dirtied module-level-state
 *      suites (session ledger singleton, tls tmpdir keylog fixtures) and
 *      reported false failures on the second pass, plus it doubled gate time.
 *
 * The `summarizeHandlerFn` block locks the handler-fn resolution order fixed
 * in the 2026-11-14 mapping-gap repair:
 *   scoped exact fn-map name (definitions in `src/server/domains/**` or
 *   `src/modules/**` only; delegation shims yield to real implementations) →
 *   legacy global exact name (only for names with no in-tree definition) →
 *   decl-position (V8 records class-property arrows as nameless
 *   `(anonymous_N)` at the property's source line) → `XTool`→`X`
 *   delegate name → excluded-domain short-circuit, and only then "unmapped".
 * The legacy fallback paths are byte-identical to the pre-fix ones; the
 * scoped path changes only names whose global denominator previously mixed
 * foreign same-named definitions (measured diff: exactly the four 50% rows —
 * memory_bookmark, binary_entropy_profile, nemu_read_memory,
 * nemu_write_memory — move to 100%, all other 732 tools unchanged).
 */
import { describe, expect, it } from 'vitest';
import {
  statsFromSuiteResults,
  summarizeHandlerFn,
  type CoverageMeta,
  type MethodSite,
} from '@tests/benchmarks/per-tool-scorecard.suite';
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

describe('summarizeHandlerFn', () => {
  function covFixture(over: Partial<CoverageMeta> = {}): CoverageMeta {
    return {
      available: true,
      fnHit: new Map(),
      fnTotal: new Map(),
      fnDefsInTree: new Map(),
      instrumentedDomains: new Set(['net']),
      fnsByPos: new Map(),
      ...over,
    };
  }
  const noSites = (): Map<string, MethodSite[]> => new Map();
  const sites = (entries: Record<string, MethodSite[]>): Map<string, MethodSite[]> =>
    new Map(Object.entries(entries));

  it('resolves exact fn-map names first (historical path, unchanged for names with no in-tree def)', () => {
    const cov = covFixture({
      fnHit: new Map([['handleFoo', 1]]),
      fnTotal: new Map([['handleFoo', 2]]),
    });
    expect(summarizeHandlerFn(cov, 'net', ['handleFoo'], noSites)).toBe('50%');
  });

  it('scoped in-tree def excludes a foreign same-named def from the denominator', () => {
    // Measured shape (nemu_read_memory): the bound handler in the domain tree
    // was executed, while an unrelated src/native same-named method was not.
    // The global maps still say 1/2; the scoped denominator must see 1/1.
    const cov = covFixture({
      fnHit: new Map([['handleRead', 1]]),
      fnTotal: new Map([['handleRead', 2]]),
      fnDefsInTree: new Map([['handleRead', [{ hit: true, delegator: false }]]]),
    });
    expect(summarizeHandlerFn(cov, 'native-emulator', ['handleRead'], noSites)).toBe('100%');
  });

  it('delegation shims yield to the real in-tree implementation', () => {
    // Measured shape (memory_bookmark / binary_entropy_profile): facade shim
    // never executed (no router-level test), impl executed directly by unit
    // tests. Counting the shim reported 50%; the shim is wiring, so only the
    // implementation forms the denominator.
    const cov = covFixture({
      fnDefsInTree: new Map([
        [
          'handleDispatch',
          [
            { hit: false, delegator: true },
            { hit: true, delegator: false },
          ],
        ],
      ]),
    });
    expect(summarizeHandlerFn(cov, 'memory', ['handleDispatch'], noSites)).toBe('100%');
  });

  it('a scoped in-tree def that was never executed reports 0% (real measurement)', () => {
    const cov = covFixture({
      fnDefsInTree: new Map([['handleFoo', [{ hit: false, delegator: false }]]]),
    });
    expect(summarizeHandlerFn(cov, 'net', ['handleFoo'], noSites)).toBe('0%');
  });

  it('when every in-tree def is a shim, all of them are counted (no empty denominator)', () => {
    const cov = covFixture({
      fnDefsInTree: new Map([
        [
          'handleFoo',
          [
            { hit: false, delegator: true },
            { hit: true, delegator: true },
          ],
        ],
      ]),
    });
    expect(summarizeHandlerFn(cov, 'net', ['handleFoo'], noSites)).toBe('50%');
  });

  it('hits without totals render 100% (unchanged)', () => {
    const cov = covFixture({ fnHit: new Map([['handleFoo', 1]]) });
    expect(summarizeHandlerFn(cov, 'net', ['handleFoo'], noSites)).toBe('100%');
  });

  it('returns not-measured / no-binding / excluded before any fallback runs', () => {
    expect(summarizeHandlerFn(covFixture({ available: false }), 'net', ['x'], noSites)).toBe(
      'not measured',
    );
    expect(summarizeHandlerFn(covFixture(), 'net', [], noSites)).toBe('no manifest binding');
  });

  it('excluded-domain short-circuit wins over position fallbacks', () => {
    // Domain NOT instrumented, yet a covered position would match — the
    // excluded branch must keep precedence (env-gated file semantics).
    const cov = covFixture({
      instrumentedDomains: new Set<string>(),
      fnsByPos: new Map([['net/handlers.impl.ts', new Map([[9, { hit: 1, total: 1 }]])]]),
    });
    const resolver = sites({
      x: [{ fileRel: 'net/handlers.impl.ts', line: 9 }],
    });
    expect(summarizeHandlerFn(cov, 'net', ['handleX'], () => resolver)).toBe(
      'excluded (env-gated file not instrumented)',
    );
  });

  it('resolves arrow-property handlers by decl position (fnMap records them nameless)', () => {
    const cov = covFixture({
      fnsByPos: new Map([['net/handlers.impl.ts', new Map([[126, { hit: 1, total: 1 }]])]]),
    });
    const resolver = sites({
      handleBuffersDispatch: [{ fileRel: 'net/handlers.impl.ts', line: 126 }],
    });
    expect(summarizeHandlerFn(cov, 'net', ['handleBuffersDispatch'], () => resolver)).toBe('100%');
  });

  it('a position-resolved but never-executed fn reports 0% (real measurement)', () => {
    const cov = covFixture({
      fnsByPos: new Map([['net/handlers.impl.ts', new Map([[126, { hit: 0, total: 1 }]])]]),
    });
    const resolver = sites({
      handleBuffersDispatch: [{ fileRel: 'net/handlers.impl.ts', line: 126 }],
    });
    expect(summarizeHandlerFn(cov, 'net', ['handleBuffersDispatch'], () => resolver)).toBe('0%');
  });

  it('uncovered definition site falls through to the XTool→X delegate name', () => {
    const cov = covFixture({
      fnHit: new Map([['handleFoo', 1]]),
      fnTotal: new Map([['handleFoo', 1]]),
    });
    const resolver = sites({
      // facade binding lives in a coverage-excluded file → position lookup misses
      handleFooTool: [{ fileRel: 'net/handlers/handler-class.ts', line: 8 }],
    });
    expect(summarizeHandlerFn(cov, 'net', ['handleFooTool'], () => resolver)).toBe('100%');
  });

  it('aggregates a mixed multi-method tool over its fallback-resolved subset', () => {
    // Neither method exists in the exact fn-map: one resolves by position,
    // the other resolves nowhere — the percentage covers the resolved subset.
    const cov = covFixture({
      fnsByPos: new Map([['net/handlers.impl.ts', new Map([[3, { hit: 1, total: 2 }]])]]),
    });
    const resolver = sites({
      handleFooTool: [{ fileRel: 'net/handlers.impl.ts', line: 3 }],
    });
    expect(summarizeHandlerFn(cov, 'net', ['handleFooTool', 'handleGhost'], () => resolver)).toBe(
      '50%',
    );
  });

  it('names the uncovered file when the bound fn exists but is coverage-excluded', () => {
    const resolver = sites({
      handleFooTool: [{ fileRel: 'net/handlers/handler-class.ts', line: 84 }],
    });
    expect(summarizeHandlerFn(covFixture(), 'net', ['handleFooTool'], () => resolver)).toBe(
      'unmapped (handler fn defined in net/handlers/handler-class.ts:84 — file absent from coverage fn-map)',
    );
  });

  it('keeps the generic unmapped wording when no definition site exists at all', () => {
    expect(summarizeHandlerFn(covFixture(), 'net', ['handleGhost'], noSites)).toBe(
      'unmapped (handler fns absent from coverage fn-map)',
    );
  });
});
