#!/usr/bin/env node
/**
 * Measure the e2e layer for the per-tool scorecard with REAL task runs:
 * builds the server, runs tests/e2e against the fixture site, and maps every
 * PASSED e2e test to the tools it exercises (tool names referenced in the file).
 * Writes artifacts/benchmarks/e2e-results.json — the scorecard's e2e layer input.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/benchmarks');
mkdirSync(outDir, { recursive: true });

console.log('[bench:e2e] building server and running e2e real-task tests (3 rounds for pass^k)…');
spawnSync('node', ['scripts/build.mjs'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const ROUNDS = 3;
const allResults = [];

for (let round = 1; round <= ROUNDS; round++) {
  const roundFile = resolve(root, `tests/e2e/e2e-results-round${round}.json`);
  console.log(`[bench:e2e] round ${round}/${ROUNDS}…`);
  spawnSync(
    'corepack',
    [
      'pnpm',
      'exec',
      'vitest',
      'run',
      '--config',
      'tests/e2e/vitest.e2e.config.ts',
      '--reporter=json',
      `--outputFile=${roundFile}`,
    ],
    {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        E2E_TARGET_URL: process.env.E2E_TARGET_URL ?? 'https://vmoranv.github.io/jshookmcp/',
        PUPPETEER_HEADLESS: process.env.PUPPETEER_HEADLESS ?? 'true',
        E2E_PASSK_ROUND: String(round),
      },
    },
  );

  if (existsSync(roundFile)) {
    allResults.push(JSON.parse(readFileSync(roundFile, 'utf8')));
  }
}

// Merge: for each file take the MINIMUM pass rate across rounds (pass^k semantics).
const mergedFileStats = {};
const mergedPassedFiles = new Set();

for (const report of allResults) {
  for (const t of report.testResults ?? []) {
    const statuses = (t.assertionResults ?? []).map((a) => a.status);
    const passed = statuses.filter((s) => s === 'passed').length;
    const total = statuses.length;
    const fname = basename(t.name ?? '');
    const prev = mergedFileStats[fname];
    const curRate = total ? passed / total : 0;
    if (!prev || curRate < prev.passRate) {
      mergedFileStats[fname] = { passed, total, passRate: curRate };
    }
  }
}

// Files that pass all 3 rounds (pass^k): ≥90% in every round.
for (const [fname, stats] of Object.entries(mergedFileStats)) {
  if (stats.passRate >= 0.9) mergedPassedFiles.add(fname);
}

console.log(
  `[bench:e2e] pass^k (3 rounds): ${mergedPassedFiles.size} files ≥90% across all runs → measuring against min pass rate`,
);
// Map each passed file to the tools it references (registry universe).
const domainsText = readFileSync(
  join(root, 'src/server/registry/generated-tool-domains.ts'),
  'utf8',
);
const allTools = [...domainsText.matchAll(/([a-z0-9_]+):\s*'/g)].map((m) => m[1]);
const e2eDir = join(root, 'tests/e2e');
const passedTools = new Set();
for (const f of mergedPassedFiles) {
  const text = readFileSync(join(e2eDir, f), 'utf8');
  for (const tool of allTools) {
    if (text.includes(`'${tool}'`) || text.includes(`"${tool}"`)) passedTools.add(tool);
  }
}
const lastReport = allResults[allResults.length - 1] ?? {};
// The build (scripts/build.mjs) runs between the initial mkdir and this write;
// on a fresh checkout the output directory may not survive that step (or the
// caller's cwd may differ). Re-create it so the measurement is never lost.
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'e2e-results.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      suite: 'tests/e2e (real tasks)',
      metric: 'pass^k (min pass rate across rounds)',
      rounds: ROUNDS,
      passRateThreshold: 0.9,
      measuredFiles: [...mergedPassedFiles],
      fileStats: mergedFileStats,
      totalTests: lastReport.numTotalTests ?? 0,
      passedTests: lastReport.numPassedTests ?? 0,
      toolFileCounts: Object.fromEntries(
        [...passedTools].map((tool) => {
          let count = 0;
          for (const f of mergedPassedFiles) {
            const text = readFileSync(join(root, 'tests/e2e', f), 'utf8');
            if (text.includes(`'${tool}'`) || text.includes(`"${tool}"`)) count += 1;
          }
          return [tool, count];
        }),
      ),
    },
    null,
    2,
  )}\n`,
);
console.log(
  `[bench:e2e] ${mergedPassedFiles.size} passed files → ${passedTools.size} tools measured`,
);
process.exit(0);
