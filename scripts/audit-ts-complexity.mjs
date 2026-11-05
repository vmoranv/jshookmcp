#!/usr/bin/env node
// TypeScript cyclomatic-complexity drift guard.
//
// WHY THIS EXISTS
// ---------------
// CCG's `verify-quality` gate only computes cyclomatic/function complexity for
// Python (its `def`-regex analyzer). Every `.ts` file is routed through
// `analyzeGenericFile`, which measures file length and line length only — so a
// TS function with CC=210 is invisible to that gate. This repo is ~100% TS.
//
// This guard computes REAL cyclomatic complexity over the TypeScript AST using
// `@babel/parser` (already a direct dependency), and is a RATCHET: a committed
// baseline records every function at/above TRACK_FLOOR. The build fails when
// (a) a baselined function's complexity INCREASES beyond its recorded value, or
// (b) a NEW function crosses TRACK_FLOOR without being acknowledged via
// `--write-baseline`. It does NOT fail on existing high-complexity functions —
// those are tracked debt, not new regressions. Lowering a function's CC is
// always allowed; `--write-baseline` records the improvement.
//
// Complexity model (matches common CC definitions):
//   +1 per function/method/arrow (base), plus one per
//   if / ternary / for / for-in / for-of / while / do-while / case / catch /
//   && / || / ??  inside it. Nested functions are counted separately.
//
// Usage:
//   node scripts/audit-ts-complexity.mjs                 # check (CI)
//   node scripts/audit-ts-complexity.mjs --write-baseline # refresh baseline
//   node scripts/audit-ts-complexity.mjs --json
//
// Exit codes: 0 pass / 1 regression / 2 could not analyze.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const SCAN_DIR = join(projectRoot, 'src');
const BASELINE_FILE = join(projectRoot, 'scripts', 'audit-ts-complexity.baseline.json');

/** Only functions at/above this CC are tracked (keeps the baseline small). */
const TRACK_FLOOR = 25;

const WRITE = process.argv.includes('--write-baseline');
const JSON_OUT = process.argv.includes('--json');

const DECISION = new Set([
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoStatement',
  'SwitchCase',
  'CatchClause',
]);
const LOGICAL = new Set(['&&', '||', '??']);
const FN = new Set([
  'FunctionDeclaration',
  'ObjectMethod',
  'ClassMethod',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassPrivateMethod',
]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts'))
      out.push(f);
  }
  return out;
}

/** Recurse over a Babel AST node's child node objects (skip metadata keys). */
function children(node) {
  const out = [];
  for (const k of Object.keys(node)) {
    if (
      k === 'loc' || k === 'start' || k === 'end' || k === 'extra' ||
      k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments' ||
      k === 'tokens' || k === 'errors' || k === 'comments' || k === 'range'
    ) continue;
    const v = node[k];
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === 'string') out.push(c);
      } else if (typeof v.type === 'string') out.push(v);
    }
  }
  return out;
}

/** Count decision points inside a function node (does not descend into nested fns). */
function complexityOf(fnNode) {
  let c = 1;
  const stack = children(fnNode);
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    if (DECISION.has(n.type)) {
      // a `default:` clause (SwitchCase with no test) adds no branch
      if (n.type !== 'SwitchCase' || n.test) c++;
    }
    if (n.type === 'LogicalExpression' && LOGICAL.has(n.operator)) c++;
    if (FN.has(n.type)) continue; // nested function = separate measurement
    for (const ch of children(n)) stack.push(ch);
  }
  return c;
}

function analyze() {
  const files = walk(SCAN_DIR);
  const rows = [];
  let parseErrors = 0;
  for (const f of files) {
    let ast;
    try {
      ast = parser.parse(readFileSync(f, 'utf8'), {
        sourceType: 'module',
        plugins: ['typescript', 'decorators-legacy', 'classProperties'],
        errorRecovery: true,
      });
    } catch {
      parseErrors++;
      continue;
    }
    const rel = relative(SCAN_DIR, f).split(sep).join('/');
    const stack = [ast];
    const seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      if (FN.has(n.type)) {
        const name = n.id?.name ?? n.key?.name ?? n.key?.value ?? '<anon>';
        const line = n.loc?.start.line ?? 0;
        rows.push({ key: `${rel}:${line}:${name}`, file: rel, line, name, cc: complexityOf(n) });
      }
      for (const ch of children(n)) stack.push(ch);
    }
  }
  return { files: files.length, parseErrors, rows };
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const { files, parseErrors, rows } = analyze();
if (parseErrors > 0) {
  console.error(`[complexity] ${parseErrors} file(s) failed to parse — cannot trust the report.`);
  process.exit(2);
}

const tracked = rows.filter((r) => r.cc >= TRACK_FLOOR);
const baseline = loadBaseline();

if (WRITE) {
  const next = {};
  for (const r of tracked) next[r.key] = r.cc;
  writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`[complexity] baseline written: ${Object.keys(next).length} functions >= CC ${TRACK_FLOOR}`);
  process.exit(0);
}

const failures = [];
// Ratchet: a baselined function must not get worse; a newly-hot function
// (>= floor) must be acknowledged via --write-baseline before it lands.
for (const r of tracked) {
  const prev = baseline[r.key];
  if (prev === undefined) {
    failures.push(`new high-complexity function ${r.key} has CC ${r.cc} (not in baseline)`);
  } else if (r.cc > prev) {
    failures.push(`${r.key} CC increased ${prev} -> ${r.cc}`);
  }
}
const improved = tracked
  .filter((r) => baseline[r.key] !== undefined && r.cc < baseline[r.key])
  .map((r) => `${r.key} ${baseline[r.key]} -> ${r.cc}`);

const worst = rows.toSorted((a, b) => b.cc - a.cc).slice(0, 5);
const result = {
  scannedFiles: files,
  totalFunctions: rows.length,
  trackFloor: TRACK_FLOOR,
  trackedFunctions: tracked.length,
  baselinedFunctions: Object.keys(baseline).length,
  improved,
  worst,
  failures,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(
    `[complexity] scanned ${files} TS files, ${rows.length} functions; ` +
      `${tracked.length} >= CC ${TRACK_FLOOR}; ${improved.length} improved`,
  );
  console.log('[complexity] worst:', worst.map((w) => `${w.name}=${w.cc}`).join(', '));
  if (failures.length) {
    console.error(`[complexity] ${failures.length} regression(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('[complexity] reduce complexity, or run `node scripts/audit-ts-complexity.mjs --write-baseline` after an intentional increase.');
  } else {
    console.log('[complexity] pass — no complexity regressions.');
  }
}

process.exit(failures.length ? 1 : 0);
