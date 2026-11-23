#!/usr/bin/env node
/**
 * Measure the unit layer for the per-tool scorecard with a REAL test run:
 *   vitest run --coverage (V8, function-level) → coverage/coverage-final.json
 * plus a timestamp meta file. The per-tool scorecard reads these — static
 * reference counts are never substituted for a missing measurement.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
console.log('[bench:coverage] running full vitest suite with V8 coverage (this takes a while)…');
const res = spawnSync(
  'corepack',
  [
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--coverage',
    '--coverage.reporter=json',
    '--coverage.reporter=text-summary',
    '--coverage.reportsDirectory=coverage',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    // This run generates the measurement the per-tool scorecard reads. Set the
    // COVERAGE_FULL marker so the in-run gate exempts the not-yet-written file.
    env: { ...process.env, COVERAGE_FULL: 'true' },
  },
);

const coverageFile = resolve(root, 'coverage/coverage-final.json');
if (!existsSync(coverageFile)) {
  console.error('[bench:coverage] coverage-final.json was not produced');
  process.exit(res.status ?? 1);
}
mkdirSync(resolve(root, 'coverage'), { recursive: true });
writeFileSync(
  resolve(root, 'coverage/.bench-coverage-meta.json'),
  `${JSON.stringify({ measuredAt: new Date().toISOString() }, null, 2)}\n`,
);
console.log('[bench:coverage] measured → coverage/coverage-final.json');
process.exit(res.status ?? 0);
