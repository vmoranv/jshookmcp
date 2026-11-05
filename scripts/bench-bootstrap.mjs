#!/usr/bin/env node
/**
 * Reproducible benchmark bootstrap for a fresh checkout.
 *
 * The per-tool scorecard (tests/benchmarks/per-tool-scorecard.suite.ts) reads
 *   artifacts/benchmarks/e2e-results.json       -> loadE2eCoverage()
 *   artifacts/benchmarks/retrieval-metrics.json -> loadRetrievalMetrics()
 * but those files are produced by SEPARATE benchmark runs and are gitignored
 * (artifacts/). On a fresh checkout they are absent, so the measurement inputs
 * are missing before anything has actually been measured.
 *
 * This script only makes the INPUTS well-formed and explicitly UNMEASURED. It
 * writes a placeholder ONLY WHEN THE FILE IS ABSENT and never overwrites a real
 * measurement (the 'wx' create-exclusive flag makes that race-safe too).
 *
 * Honesty: the placeholders carry NO numeric measurement. The e2e placeholder
 * has an empty `toolFileCounts` map, so loadE2eCoverage() reports
 * `available: false` ("not measured"). The retrieval placeholder omits
 * `mrrAt10`/`pAt1` entirely, so loadRetrievalMetrics() returns null. Nothing
 * here is a guessed score, count, rank, or throughput.
 *
 * coverage/coverage-final.json is NOT touched — it belongs to test:coverage.
 *
 * Usage:
 *   node scripts/bench-bootstrap.mjs           # create missing placeholders
 *   node scripts/bench-bootstrap.mjs --check   # report presence, write nothing
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.cwd();
const outDir = resolve(root, 'artifacts', 'benchmarks');

/**
 * Placeholder payloads. `measured: false` is a boolean STATE marker, not a
 * metric. The loaders degrade to "not measured"/null from these shapes because
 * there is no numeric data and no per-tool file counts.
 */
const PLACEHOLDERS = {
  'e2e-results.json': {
    measured: false,
    toolFileCounts: {},
    note: 'bootstrap placeholder — run pnpm bench:e2e (or the e2e real-task benchmark) for a real measurement; no files have been measured yet',
  },
  'retrieval-metrics.json': {
    measured: false,
    note: 'bootstrap placeholder — run the retrieval benchmark (tests/server/benchmarks/retrieval-metrics.test.ts) for a real measurement; mrrAt10/pAt1 are intentionally absent',
  },
};

const checkMode = process.argv.includes('--check');
const names = Object.keys(PLACEHOLDERS);
const present = new Set(names.filter((name) => existsSync(join(outDir, name))));

if (checkMode) {
  // Report presence of each file (placeholder OR real measurement) without
  // writing anything. Always exits 0: presence is reported, not enforced.
  for (const name of names) {
    console.log(`[bench-bootstrap] ${name}: ${present.has(name) ? 'present' : 'missing'}`);
  }
  const missing = names.filter((name) => !present.has(name));
  console.log(
    `[bench-bootstrap --check] ${present.size}/${names.length} present` +
      (missing.length > 0 ? `; missing: ${missing.join(', ')}` : '; all present'),
  );
} else {
  // Create the directory on a fresh checkout. Creating an existing directory
  // is a no-op (recursive: true).
  mkdirSync(outDir, { recursive: true });
  for (const [name, payload] of Object.entries(PLACEHOLDERS)) {
    const target = join(outDir, name);
    // 'wx' = create-exclusive: fails if the file already exists, so a real
    // measurement (or a concurrent writer's file) is never clobbered.
    try {
      writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
      console.log(`[bench-bootstrap] created ${name} (placeholder, unmeasured)`);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
        console.log(`[bench-bootstrap] skipped ${name} (already present — not overwritten)`);
      } else {
        throw err;
      }
    }
  }
}
