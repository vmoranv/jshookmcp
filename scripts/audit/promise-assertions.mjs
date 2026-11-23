#!/usr/bin/env node
// Promise-assertion audit.
//
// WHY THIS EXISTS
// ---------------
// vitest has two behaviours that together turn a careless assertion into a
// silent hole in the suite:
//
//   1. `expect(x).resolves.toBe(y)` returns a promise. If the statement is
//      never awaited, nothing observes it — the assertion does not run, and a
//      rejecting one cannot fail the test.
//   2. vitest papered over this by auto-awaiting hanging assertions at the end
//      of a test, which is exactly why the hole stayed invisible: the suite
//      went green either way. vitest warns today and has announced it will
//      HARD-FAIL in the next major.
//
// Found in the wild on 2026-10-08 in
// `tests/native/platform/{Darwin,Linux}BreakpointEngine.test.ts`, where
// `expect(Promise.resolve(engine.removeBreakpoint('nonexistent'))).resolves.toBe(false)`
// had been asserting nothing at all. Those two are fixed; this audit is what
// keeps the next one from landing.
//
// WHAT IT CHECKS
// --------------
// A bare expression statement whose CALL CHAIN (callee/object only — never
// arguments) contains `.resolves` or `.rejects`. That is precisely the shape
// vitest warns about.
//
// Correct shapes that must stay silent:
//   await expect(x).resolves.toBe(y);          -> AwaitExpression, not a chain match
//   return expect(x).resolves.toBe(y);         -> ReturnStatement, not an expression statement
//   const a = expect(x).rejects.toThrow();     -> VariableDeclaration
//   void expect(x).resolves.toBe(y);           -> UnaryExpression
//   expect(await f()).resolves.toBe(y);        -> the await is an ARGUMENT, never visited
//
// VACUITY GUARD
// -------------
// A scanner that silently stops reading files reports a clean tree and protects
// nothing. So the run ABORTS (exit 2) when it parsed zero test files, or when it
// saw zero `.resolves`/`.rejects` chains at all — the latter is the canary: this
// repo has thousands of them, so reading none means the scanner is broken, not
// that the tree is clean. See scripts/audit/promise-assertions.selftest.mjs for
// the proof that both branches actually fire.
//
// Run: `pnpm audit:promises`. Wired into `pnpm check`.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const SCAN_ROOT = join(projectRoot, 'tests');

// Mirrors the `!tests/tmp/**` exclusion used by oxfmt / oxlint in package.json.
const EXCLUDED_DIRS = new Set(['tmp', 'node_modules']);

/**
 * Walk ONLY the callee/object chain, never arguments.
 *
 * Descending into arguments is the bug that made the first draft of this
 * scanner report 2836 hits: `it('...', () => { await expect(x)... })` is a call
 * whose ARGUMENTS contain a (correctly awaited) assertion, and a
 * subtree-wide search happily matched it. Restricting to the chain means a
 * statement is judged by what it IS, not by what it contains.
 */
function chainHasPromiseMatcher(node) {
  let cur = node;
  while (cur) {
    switch (cur.type) {
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const name = cur.property?.name ?? cur.property?.value;
        if (name === 'resolves' || name === 'rejects') return true;
        cur = cur.object;
        break;
      }
      case 'CallExpression':
      case 'OptionalCallExpression':
        cur = cur.callee;
        break;
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
      case 'TSInstantiationExpression':
        cur = cur.expression;
        break;
      default:
        return false;
    }
  }
  return false;
}

/** Recursively collect every node of the AST. */
function* walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  yield node;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments') continue;
    const child = node[key];
    if (child && typeof child === 'object') yield* walk(child);
  }
}

function* testFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* testFiles(join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield join(dir, entry.name);
    }
  }
}

const violations = [];
let filesScanned = 0;
let matchersSeen = 0;
let unparseable = 0;

/**
 * Canary: count every `.resolves` / `.rejects` member access ANYWHERE in the
 * tree, arguments included.
 *
 * This must NOT reuse chainHasPromiseMatcher. That function is deliberately
 * chain-only, so on a clean tree it returns false for every statement — which
 * would make a "did we see any?" check on its output read 0 on a healthy repo
 * and turn the vacuity guard into a false alarm. (It did, on the first run:
 * "found 0 chains in 1413 files" on a tree with thousands.)
 */
function countMatchers(node) {
  for (const candidate of walk(node)) {
    if (candidate.type !== 'MemberExpression' && candidate.type !== 'OptionalMemberExpression') {
      continue;
    }
    const name = candidate.property?.name ?? candidate.property?.value;
    if (name === 'resolves' || name === 'rejects') matchersSeen += 1;
  }
}

// @babel/parser rather than the `typescript` package: this repo is on
// typescript@7, whose JS surface is the native port and exposes no compiler API
// (no createSourceFile / forEachChild).
const { parse } = await import('@babel/parser');

/**
 * Positive control on the matcher itself, run on EVERY invocation.
 *
 * The vacuity guard above cannot cover this: if chainHasPromiseMatcher breaks
 * and always returns false, the tree scan yields zero violations and zero
 * unparseable files — a clean PASS on a tree that may be full of holes. The
 * matcher count would still look healthy, because countMatchers is a different
 * function.
 *
 * So assert the matcher's verdict on known snippets before trusting its verdict
 * on 1400 files. A guard that cannot demonstrate it detects the thing it guards
 * against is decoration.
 */
const SELF_CHECK_CASES = [
  { id: 'bare single-line', code: 'expect(f()).resolves.toBe(1);', detected: true },
  { id: 'bare multi-line', code: 'expect(\n  f(),\n).resolves.toBe(1);', detected: true },
  { id: 'bare rejects', code: "expect(f()).rejects.toThrow('x');", detected: true },
  { id: 'bare optional-chain', code: 'expect(f())?.resolves?.toBe(1);', detected: true },
  { id: 'awaited', code: 'await expect(f()).resolves.toBe(1);', detected: false },
  { id: 'returned', code: 'return expect(f()).resolves.toBe(1);', detected: false },
  { id: 'assigned', code: 'const a = expect(f()).resolves.toBe(1);', detected: false },
  {
    id: 'awaited inside it()',
    code: "it('x', () => { await expect(f()).resolves.toBe(1); });",
    detected: false,
  },
];

{
  const broken = [];
  for (const testCase of SELF_CHECK_CASES) {
    const ast = parse(testCase.code, {
      sourceType: 'module',
      plugins: ['typescript'],
      errorRecovery: true,
    });
    let detected = false;
    for (const node of walk(ast.program)) {
      if (node.type === 'ExpressionStatement' && chainHasPromiseMatcher(node.expression)) {
        detected = true;
        break;
      }
    }
    if (detected !== testCase.detected) {
      broken.push(`  ${testCase.id}: expected detected=${testCase.detected}, got ${detected}`);
    }
  }
  if (broken.length > 0) {
    console.error('[promise-assertions] ABORT: the matcher self-check failed.');
    console.error('    It disagrees with known snippets, so its verdict on the real tree is');
    console.error('    meaningless — a PASS here would be a false negative, not a clean tree.');
    for (const line of broken) console.error(line);
    process.exit(2);
  }
}

for (const file of testFiles(SCAN_ROOT)) {
  const code = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    });
  } catch (error) {
    unparseable += 1;
    console.error(`[promise-assertions] FAIL: could not parse ${relative(projectRoot, file)}`);
    console.error(`    ${error.message}`);
    continue;
  }

  filesScanned += 1;
  countMatchers(ast.program);
  for (const node of walk(ast.program)) {
    if (node.type !== 'ExpressionStatement') continue;
    if (!chainHasPromiseMatcher(node.expression)) continue;
    const line = node.loc?.start?.line ?? 0;
    const text = code.slice(node.start, node.end).replace(/\s+/g, ' ').trim();
    violations.push(`${relative(projectRoot, file).split(sep).join('/')}:${line}  ${text}`);
  }
}

// ── vacuity guard ────────────────────────────────────────────────────────────
if (filesScanned === 0) {
  console.error('[promise-assertions] ABORT: scanned 0 test files.');
  console.error('    The scan root moved or the walker broke; a clean report would be a lie.');
  process.exit(2);
}

if (matchersSeen === 0) {
  console.error(
    `[promise-assertions] ABORT: found 0 .resolves/.rejects matchers in ${filesScanned} files.`,
  );
  console.error('    This suite contains thousands of them, so reading none means the scanner');
  console.error('    stopped resolving call chains — not that the tree is clean.');
  process.exit(2);
}

// ── verdict ──────────────────────────────────────────────────────────────────
if (violations.length > 0) {
  console.error(
    `\n[promise-assertions] FAIL: ${violations.length} unawaited promise assertion(s).\n`,
  );
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    '\n  These assert nothing today. vitest auto-awaits them for now and will hard-fail\n' +
      '  on them in the next major. Fix with `async () => { await expect(...) }`.\n',
  );
  process.exit(1);
}

if (unparseable > 0) {
  console.error(`[promise-assertions] FAIL: ${unparseable} file(s) could not be parsed.`);
  process.exit(1);
}

console.log(
  `PASS: All checks passed. (${matchersSeen} promise matchers across ${filesScanned} test files, none unawaited)`,
);
