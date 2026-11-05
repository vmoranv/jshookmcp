#!/usr/bin/env node
/**
 * Run the tool benchmark suites and emit a scorecard.
 *
 *   corepack pnpm bench:tools
 *
 * Writes artifacts/benchmarks/scorecard.md + .json and prints the summary.
 * Exit code 1 when any suite breaches its floor — CI-friendly.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const root = process.cwd();

// Ensure the two gitignored measurement files exist on a fresh checkout. The
// bootstrap writes HONEST placeholders (no fabricated numbers) only when a real
// measurement is absent, so the scorecard's later layers read "not measured"
// instead of crashing the gate. Real runs (bench:e2e / retrieval benchmark)
// overwrite them; bootstrap never does.
const bootstrap = spawnSync(process.execPath, ['scripts/bench-bootstrap.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
if (bootstrap.status !== 0) {
  console.error('[bench:tools] bootstrap failed');
  process.exit(bootstrap.status ?? 1);
}

const env = { ...process.env, BENCH_SCORECARD: '1' };
const res = spawnSync(
  'corepack',
  [
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--project',
    'server',
    'tests/server/benchmarks/tools-benchmark.test.ts',
  ],
  { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' },
);

const scorecardPath = resolve(root, 'artifacts/benchmarks/scorecard.md');
if (existsSync(scorecardPath)) {
  console.log('\n=== Scorecard ===\n');
  console.log(readFileSync(scorecardPath, 'utf8'));
  console.log(`Full report: ${scorecardPath}`);
}

process.exit(res.status ?? 1);
