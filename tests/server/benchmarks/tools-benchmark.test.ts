/**
 * Tool benchmark gate — runs every suite in tests/benchmarks/suites and fails when a
 * suite drops below its threshold.
 *
 * Run inside the normal `pnpm test` (server project). For a full scorecard:
 *   pnpm bench:tools   (sets BENCH_SCORECARD=1 → writes artifacts/benchmarks/scorecard.md)
 *
 * Thresholds are calibrated to the current baseline; tighten after improving tools.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBenchSuite, renderScorecard, type BenchSuiteResult } from '@tests/benchmarks/harness';
import { ALL_SUITES } from '@tests/benchmarks/suites';
import { createPerToolScorecardSuite } from '@tests/benchmarks/per-tool-scorecard.suite';

const GATE_SUITES = [...ALL_SUITES, createPerToolScorecardSuite(ALL_SUITES)];

// Per-suite floor (percent of non-skipped cases that must pass).
const SUITE_THRESHOLDS: Record<string, number> = {
  encoding: 90,
  'protocol-analysis': 90,
  transform: 90,
  'network-fingerprint': 90,
  'exploit-dev': 85,
  sourcemap: 90,
  'binary-instrument': 85,
  wasm: 85,
  'core-analysis': 85,
  // Deterministic static-scan assertions with no env gating — every case must
  // pass. At the old 80% floor a 5-case suite tolerated one silent failure, which
  // is exactly the shape of the domain-dir/nested-scan undercount regressions.
  'existing-tests-coverage': 100,
  'session-progress': 90,
  'tasks-lifecycle': 90,
  'coordination-lifecycle': 90,
  'cross-domain': 90,
  'native-bridge': 90,
  'process-static': 90,
  'trace-query': 90,
  platform: 90,
  'memory-pure-ts': 90,
  'per-tool-scorecard': 90,
  'tls-inspector': 90,
  'tls-inspector-full': 85,
  'misc-residual': 80,
  'dart-inspector': 90,
  maintenance: 90,
  'electron-fuses': 90,
  'sourcemap-tc39': 80,
  'offline-tools': 80,
};

const results: BenchSuiteResult[] = [];

describe('tool benchmark gate', () => {
  it('runs all tool benchmark suites and meets thresholds', { timeout: 120_000 }, async () => {
    const failures: string[] = [];
    for (const suite of GATE_SUITES) {
      const result = await runBenchSuite(suite);
      results.push(result);
      const floor = SUITE_THRESHOLDS[suite.name] ?? 80;
      // eslint-disable-next-line no-console
      console.log(
        `[bench] ${suite.name}: ${result.passed}/${result.total - result.skipped} (${result.score.toFixed(1)}%, floor ${floor}%), skipped=${result.skipped}`,
      );
      for (const c of result.cases) {
        if (c.status === 'fail' || c.status === 'error') {
          // eslint-disable-next-line no-console
          console.log(`[bench]   ${c.name} [${c.status}] ${c.detail ?? ''}`);
        }
      }
      if (result.score < floor) {
        failures.push(`${suite.name}: ${result.score.toFixed(1)}% < ${floor}%`);
      }
    }

    if (process.env.BENCH_SCORECARD === '1') {
      const outDir = resolve(process.cwd(), 'artifacts/benchmarks');
      mkdirSync(outDir, { recursive: true });
      const md = renderScorecard(results);
      writeFileSync(resolve(outDir, 'scorecard.md'), md);
      writeFileSync(
        resolve(outDir, 'scorecard.json'),
        JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
      );
      // eslint-disable-next-line no-console
      console.log(`[bench] scorecard written to artifacts/benchmarks/scorecard.md`);
    }

    expect(failures, `benchmark floors breached:\n${failures.join('\n')}`).toEqual([]);
  });
});
