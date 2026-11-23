#!/usr/bin/env node
// Self-test for scripts/audit/promise-assertions.mjs.
//
// WHY THIS EXISTS
// ---------------
// The audit is the only thing standing between this repo and another silent
// hole of the kind found on 2026-10-08, where two assertions had been running
// for nobody. A guard that never fails protects nothing, and a guard that fails
// for the wrong reason gets deleted — and from outside, both look identical:
// they print PASS.
//
// The only way to tell them apart is to make the guard fail on purpose and
// check it fails for the stated reason. So each case mutates exactly one file,
// runs the audit, asserts the exit code AND the text it produced, then restores
// the file and re-hashes it. A restore that does not reproduce the original
// bytes aborts the whole run: a self-test that corrupts the tree is worse than
// no self-test at all.
//
// The cases are deliberately not all "inject a bad line":
//
//   T1/T2  the RED side — a bare chain must be caught, in both the single-line
//          and the multi-line shape (the multi-line shape is the one a
//          line-oriented grep misses, and this scanner exists because a grep
//          missed it).
//   T3     the GREEN side — a correctly awaited assertion must stay silent.
//          Without this, a scanner that flags everything would pass T1/T2.
//   T4/T5  the ABORT side — the two ways the guard could go quietly vacuous.
//          T4 breaks the matcher (it would then find nothing and print PASS);
//          T5 breaks the file walker (same outcome, different cause). Both must
//          exit 2, not 0.
//
// NOT part of `pnpm check`. It writes to the tree by design, and a CI job that
// mutates source is a hazard rather than a check. Run it by hand whenever the
// audit changes: `pnpm audit:promises:selftest`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const AUDIT = join(projectRoot, 'scripts', 'audit', 'promise-assertions.mjs');

// The file where the 2026-10-08 hole actually lived. Using it keeps the
// self-test tied to a real shape rather than a synthetic fixture.
const SUBJECT = join('tests', 'native', 'platform', 'DarwinBreakpointEngine.test.ts');

const MARKER = '__selftest_probe__';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// The audit prints `path:line  <statement>`, with whitespace collapsed and no
// echo of any surrounding label — so assert on the path and the failure kind,
// not on the injected marker.
const SUBJECT_PATH = 'tests/native/platform/DarwinBreakpointEngine.test.ts';
const FAILURE_KIND = 'unawaited promise assertion';

const CASES = [
  {
    id: 'T1',
    what: 'catches a bare single-line promise assertion (RED)',
    file: SUBJECT,
    patch: (source) => `${source}\n${MARKER}: expect(f()).resolves.toBe(1);\n`,
    expectExit: 1,
    expectInOutput: [SUBJECT_PATH, FAILURE_KIND],
  },
  {
    id: 'T2',
    what: 'catches a bare MULTI-LINE promise assertion (RED, the grep-proof shape)',
    file: SUBJECT,
    patch: (source) => `${source}\n${MARKER}: expect(\n  f(),\n).resolves.toBe(1);\n`,
    expectExit: 1,
    expectInOutput: [SUBJECT_PATH, FAILURE_KIND],
  },
  {
    id: 'T3',
    what: 'stays silent for a correctly awaited assertion (GREEN negative control)',
    file: SUBJECT,
    patch: (source) =>
      `${source}\nasync function ${MARKER}() { await expect(f()).resolves.toBe(1); }\n`,
    expectExit: 0,
    expectInOutput: ['PASS'],
    expectNotInOutput: [FAILURE_KIND, SUBJECT_PATH],
  },
  {
    id: 'T4',
    what: 'ABORTS instead of reporting when the matcher stops matching',
    // Makes the matcher always return false. The tree scan then yields zero
    // violations AND zero unparseable files — a PASS that means nothing. Only
    // the in-run matcher self-check can catch this, and this case proves it does.
    file: join('scripts', 'audit', 'promise-assertions.mjs'),
    patch: (source) =>
      source.replace(
        'function chainHasPromiseMatcher(node) {',
        'function chainHasPromiseMatcher(node) {\n  return false; // broken on purpose by the self-test',
      ),
    expectExit: 2,
    expectInOutput: ['ABORT', 'matcher self-check failed'],
  },
  {
    id: 'T5',
    what: 'ABORTS instead of reporting when the file walker stops walking',
    file: join('scripts', 'audit', 'promise-assertions.mjs'),
    patch: (source) =>
      source.replace(
        'function* testFiles(dir) {',
        'function* testFiles(dir) {\n  return; // broken on purpose by the self-test',
      ),
    expectExit: 2,
    expectInOutput: ['ABORT', 'scanned 0 test files'],
  },
];

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
    result = spawnSync(process.execPath, [AUDIT], {
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
  console.error('    ── audit output ──');
  for (const line of output.split('\n')) console.error(`    ${line}`);
}

console.log(`\n[selftest] ${CASES.length - failed}/${CASES.length} cases passed.`);
console.log(`[selftest] restored: ${new Set(CASES.map((c) => c.file)).size} path(s).`);
process.exit(failed === 0 ? 0 : 1);
