#!/usr/bin/env node
// Self-test for scripts/audit/readme-counts.mjs.
//
// WHY THIS EXISTS
// ---------------
// The audit is the only thing standing between this repo and another silent
// hole of the kind found on 2026-10-09: README prose said "733 tools" while the
// runtime registry had said 735 for five days, across three releases, with CI
// green the entire time. `metadata:check` validated the generated sync block and
// never looked at the prose next to it.
//
// A guard that never fails protects nothing, and a guard that fails for the
// wrong reason gets deleted — and from outside, both look identical: they print
// PASS. The only way to tell them apart is to make the guard fail on purpose and
// check it fails for the stated reason. So each case mutates exactly one file,
// runs `generate-metadata.mjs --check` (the real wiring, not the pure function),
// asserts the exit code AND the text it produced, then restores the file and
// re-hashes it. A restore that does not reproduce the original bytes aborts the
// whole run: a self-test that corrupts the tree is worse than no self-test.
//
// The cases are deliberately not all "inject a bad line":
//
//   T1     the RED side — a stale count in the English prose must be caught.
//   T2     the RED side, other language — same for the Chinese prose. The two
//          files use different matchers, so one passing proves nothing about
//          the other.
//   T3     the GREEN side — a number followed by a *near-miss* noun ("999
//          tokens") must stay silent. Without this, a matcher that flags every
//          number would pass T1/T2.
//   T4/T5  the ABORT side — the two ways the guard could go quietly vacuous.
//          T4 breaks the matcher (it would then find nothing and print PASS);
//          T5 removes the canary that proves we are reading the right file.
//          Both must exit 2, not 0 — and not 1, which would claim the repo is
//          wrong when the truth is that we cannot tell.
//
// NOT part of `pnpm check`. It writes to the tree by design, and a CI job that
// mutates source is a hazard rather than a check. Run it by hand whenever the
// audit changes: `pnpm audit:readme-counts:selftest`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const GENERATE = join(projectRoot, 'scripts', 'generate', 'metadata.mjs');
const AUDIT = join(projectRoot, 'scripts', 'audit', 'readme-counts.mjs');

const README_EN = join('README.md');
const README_ZH = join('README.zh.md');

const MARKER = '__selftest_probe__';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// The audit prints `[readme-counts] STALE: <file>:<line> ...`, with the file path
// as given. Assert on the path and the failure kind, not on line numbers.
const STALE = 'STALE';
const ABORT = 'ABORT';

const CASES = [
  {
    id: 'T1',
    what: 'catches a stale tool count in the English prose (RED)',
    file: README_EN,
    patch: (source) => source.replace('739 tools', '733 tools'),
    expectExit: 1,
    expectInOutput: [STALE, 'README.md', '733'],
  },
  {
    id: 'T2',
    what: 'catches a stale tool count in the Chinese prose (RED, separate matcher)',
    file: README_ZH,
    patch: (source) => source.replace('739 个工具', '733 个工具'),
    expectExit: 1,
    expectInOutput: [STALE, 'README.zh.md', '733'],
  },
  {
    id: 'T3',
    what: 'stays silent for a number followed by a near-miss noun (GREEN control)',
    // "999 tokens" is the shape that a sloppy matcher would flag: a number in the
    // same sentence, followed by a word starting with "tool". Appending at the very
    // end of the file keeps the generated sync block untouched, so the only thing
    // under test is the prose matcher.
    file: README_EN,
    patch: (source) => `${source}\n<!-- ${MARKER}: 999 tokens, 42 toolchains -->\n`,
    expectExit: 0,
    expectInOutput: ['OK: metadata is in sync'],
    expectNotInOutput: [STALE, ABORT, '999'],
  },
  {
    id: 'T4',
    what: 'ABORTS instead of reporting when the matcher stops matching',
    // Makes the English matcher never match. The prose scan then yields zero
    // violations — a PASS that means nothing. Only the in-run matcher self-check
    // can catch this, and this case proves it does.
    file: join('scripts', 'audit', 'readme-counts.mjs'),
    patch: (source) =>
      source.replace(
        'const EN_PROSE = ',
        'const EN_PROSE = /zzz_never_matches_zzz/g; const EN_PROSE_ORIGINAL = ',
      ),
    expectExit: 2,
    expectInOutput: [ABORT, 'matcher-self-check-failed'],
  },
  {
    id: 'T5',
    what: 'ABORTS instead of reporting when the sync-block canary disappears',
    // Renames the generated block's label so the canary regex no longer matches.
    // The guard must refuse to conclude rather than assume it is reading the
    // README it thinks it is.
    file: README_EN,
    patch: (source) => source.replace('- Built-in tools:', '- Built-in tool count:'),
    expectExit: 2,
    expectInOutput: [ABORT, 'missing-sync-block'],
  },
];

// ---------------------------------------------------------------------------
// Pre-flight: refuse to start on top of a previous run's leftovers.
// ---------------------------------------------------------------------------

const leftovers = [README_EN, README_ZH].filter((file) =>
  readFileSync(join(projectRoot, file), 'utf8').includes(MARKER),
);

if (leftovers.length > 0) {
  console.error('[selftest] ABORT: a previous run left probe artifacts behind.');
  for (const file of leftovers) console.error(`  ${file}`);
  console.error('\n  Remove the line containing the probe marker and re-run.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

if (!existsSync(GENERATE) || !existsSync(AUDIT)) {
  console.error('[selftest] ABORT: expected scripts are missing.');
  console.error(`  ${GENERATE}`);
  console.error(`  ${AUDIT}`);
  process.exit(2);
}

let failed = 0;

for (const testCase of CASES) {
  const target = join(projectRoot, testCase.file);
  const original = readFileSync(target, 'utf8');
  const before = sha256(original);
  const patched = testCase.patch(original);

  if (patched === original) {
    failed += 1;
    console.error(`[selftest] ${testCase.id} FAIL — patch changed nothing (anchor moved?)`);
    continue;
  }

  let result;
  try {
    writeFileSync(target, patched);
    result = spawnSync(process.execPath, [GENERATE, '--check'], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    writeFileSync(target, original);
    const after = sha256(readFileSync(target, 'utf8'));
    if (after !== before) {
      console.error(`[selftest] FATAL: could not restore ${testCase.file}`);
      console.error(`    expected sha256 ${before}`);
      console.error(`    actual   sha256 ${after}`);
      process.exit(2);
    }
  }

  // Normalise separators: the guard reports paths via the platform, the
  // assertions are written with forward slashes.
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll('\\', '/');
  const problems = [];
  if (result.status !== testCase.expectExit) {
    problems.push(`exit code ${result.status}, expected ${testCase.expectExit}`);
  }
  for (const needle of testCase.expectInOutput ?? []) {
    if (!output.includes(needle)) problems.push(`output never mentions "${needle}"`);
  }
  for (const needle of testCase.expectNotInOutput ?? []) {
    if (output.includes(needle)) problems.push(`output unexpectedly mentions "${needle}"`);
  }

  if (problems.length === 0) {
    console.log(`[selftest] ${testCase.id} PASS — ${testCase.what}`);
    continue;
  }

  failed += 1;
  console.error(`[selftest] ${testCase.id} FAIL — ${testCase.what}`);
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('    ── check output ──');
  for (const line of output.split('\n')) console.error(`    ${line}`);
}

// ---------------------------------------------------------------------------
// Post-flight: prove the run left nothing behind.
// ---------------------------------------------------------------------------

const residue = [README_EN, README_ZH].filter((file) =>
  readFileSync(join(projectRoot, file), 'utf8').includes(MARKER),
);
if (residue.length > 0) {
  console.error('[selftest] FATAL: probe marker survived the run in:');
  for (const file of residue) console.error(`  ${file}`);
  process.exit(2);
}

console.log(`\n[selftest] ${CASES.length - failed}/${CASES.length} cases passed.`);
console.log(
  `[selftest] restored: ${new Set(CASES.map((c) => c.file)).size} path(s), zero residue.`,
);
process.exit(failed === 0 ? 0 : 1);
