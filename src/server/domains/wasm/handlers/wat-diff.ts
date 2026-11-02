/**
 * WAT diff primitives for `wasm_diff`.
 *
 * Pure functions — no I/O, no ExternalToolRunner. Parses wasm2wat output
 * (S-expressions) into a coarse structure keyed by top-level node type, then
 * diffs two structures: set-difference over function keys + LCS-based unified
 * line-level diff for functions present in both.
 *
 * Best-effort by function name: a stripped/renamed function appears as
 * removed+added rather than changed. Unnamed functions match by ordinal.
 */

import { diffArrays } from 'diff';

export interface WatFunction {
  /** Stable diff key: $name without sigil, `__idx_N` for (;N;) markers, `__exp_X` for inline export, `__unnamed_N` otherwise. */
  key: string;
  /** Display name as it appears in WAT ($name, (;N;), etc). */
  displayName: string;
  named: boolean;
  /** Full WAT text of the function node (multiline), trimmed. */
  text: string;
  /** Text split into lines with trailing whitespace trimmed. */
  lines: string[];
}

export interface WatStructure {
  functions: WatFunction[];
  imports: string[];
  exports: string[];
  /** Other top-level nodes (type/memory/global/table/data/elem/start) raw text. */
  others: string[];
}

export interface FunctionDiff {
  key: string;
  displayName: string;
  unifiedDiff: string[];
  addedLines: number;
  removedLines: number;
}

export interface WatDiffResult {
  addedFunctions: Array<{ key: string; displayName: string }>;
  removedFunctions: Array<{ key: string; displayName: string }>;
  changedFunctions: FunctionDiff[];
  unchangedFunctions: Array<{ key: string; displayName: string }>;
  importDelta: { added: string[]; removed: string[] };
  exportDelta: { added: string[]; removed: string[] };
  summary: {
    functionsA: number;
    functionsB: number;
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
}

const FUNC_RE = /^\s*\(func\b/;
const IMPORT_RE = /^\s*\(import\b/;
const EXPORT_RE = /^\s*\(export\b/;
const MODULE_RE = /^\s*\(module\b/;

/**
 * Split a WAT module into balanced top-level S-expression node strings.
 * Tracks paren depth and skips string literals (data sections may contain
 * quotes/backslashes) so parens inside strings do not corrupt depth tracking.
 */
export function splitTopLevelNodes(wat: string): string[] {
  // Find the (module ...) container and scan its *interior* — the module's own
  // opening paren would otherwise keep depth >= 1 and hide every child node.
  let scanFrom = 0;
  const moduleStart = wat.indexOf('(module');
  if (moduleStart >= 0) {
    const openParen = wat.indexOf('(', moduleStart);
    if (openParen >= 0) scanFrom = openParen + 1;
  }
  const body = wat.slice(scanFrom);
  const nodes: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === '"' && body[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ')') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          nodes.push(body.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return nodes;
}

function extractFuncKey(node: string): { key: string; displayName: string; named: boolean } {
  const after = node.slice(node.indexOf('(func') + '(func'.length);
  const named = after.match(/^\s+\$([^\s)]+)/);
  if (named) {
    const k = named[1] as string;
    return { key: k, displayName: '$' + k, named: true };
  }
  const idx = after.match(/^\s+\(;(\d+);\)/);
  if (idx) {
    const n = idx[1] as string;
    return { key: '__idx_' + n, displayName: '(;' + n + ';)', named: false };
  }
  const exp = after.match(/^\s+\(export\s+"([^"]*)"/);
  if (exp) {
    const e = exp[1] as string;
    return { key: '__exp_' + e, displayName: '(export "' + e + '")', named: false };
  }
  return { key: '__unnamed__', displayName: '(unnamed)', named: false };
}

/** Parse wasm2wat output into a coarse structure by top-level node type. */
export function parseWatStructure(wat: string): WatStructure {
  const nodes = splitTopLevelNodes(wat);
  const functions: WatFunction[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const others: string[] = [];
  let unnamedCounter = 0;
  for (const node of nodes) {
    if (FUNC_RE.test(node)) {
      const k = extractFuncKey(node);
      let key = k.key;
      if (!k.named && key === '__unnamed__') {
        key = '__unnamed_' + unnamedCounter;
        unnamedCounter++;
      }
      const text = node.trim();
      functions.push({
        key,
        displayName: k.displayName,
        named: k.named,
        text,
        lines: text.split('\n').map((l) => l.replace(/\s+$/g, '')),
      });
    } else if (IMPORT_RE.test(node)) {
      imports.push(node.trim());
    } else if (EXPORT_RE.test(node)) {
      exports.push(node.trim());
    } else if (!MODULE_RE.test(node)) {
      others.push(node.trim());
    }
  }
  return { functions, imports, exports, others };
}

type EditStep = { type: 'eq' | 'del' | 'add'; line: string };

/**
 * LCS edit script between two line arrays, computed via the `diff` package
 * (Myers O(ND) algorithm, `diffArrays`). The returned steps carry one entry
 * per line; `unifiedDiff` applies the context-window elision on top.
 *
 * No budget guard needed: `diffArrays` is non-abortable and never returns
 * undefined; Myers O(ND) is strictly cheaper than the previous O(n*m) DP
 * table, which could OOM on large functions.
 */
function lcsEditScript(a: string[], b: string[]): EditStep[] {
  const changes = diffArrays(a, b);
  const steps: EditStep[] = [];
  for (const change of changes) {
    const type = change.added ? 'add' : change.removed ? 'del' : 'eq';
    for (const line of change.value) {
      steps.push({ type, line });
    }
  }
  return steps;
}

/**
 * LCS-based unified diff. Returns [] when the two line arrays are identical.
 * Output lines are prefixed ' ' (context), '+' (added), '-' (removed). Only
 * regions within `context` lines of a change are emitted; unchanged runs
 * outside that window are elided.
 */
export function unifiedDiff(a: string[], b: string[], context = 3): string[] {
  const steps = lcsEditScript(a, b);
  const len = steps.length;
  if (len === 0 || steps.every((s) => s.type === 'eq')) return [];
  const emit = Array.from({ length: len }, () => false);
  for (let k = 0; k < len; k++) {
    if (steps[k]!.type !== 'eq') {
      const lo = Math.max(0, k - context);
      const hi = Math.min(len - 1, k + context);
      for (let c = lo; c <= hi; c++) emit[c] = true;
    }
  }
  const result: string[] = [];
  for (let k = 0; k < len; k++) {
    if (!emit[k]) continue;
    const s = steps[k]!;
    result.push((s.type === 'eq' ? ' ' : s.type === 'del' ? '-' : '+') + s.line);
  }
  return result;
}

/** Normalize transient local/temp names so semantic diff ignores renumbering. */
function normalizeWatLines(lines: string[]): string[] {
  return lines.map((l) => l.replace(/\$[lL]\d+\b/g, '$local'));
}

export function diffWatStructures(
  a: WatStructure,
  b: WatStructure,
  options?: { semantic?: boolean },
): WatDiffResult {
  const semantic = options?.semantic === true;
  const mapA = new Map(a.functions.map((f) => [f.key, f] as const));
  const mapB = new Map(b.functions.map((f) => [f.key, f] as const));

  const addedFunctions: Array<{ key: string; displayName: string }> = [];
  const removedFunctions: Array<{ key: string; displayName: string }> = [];
  const changedFunctions: FunctionDiff[] = [];
  const unchangedFunctions: Array<{ key: string; displayName: string }> = [];

  for (const fb of b.functions) {
    if (!mapA.has(fb.key)) addedFunctions.push({ key: fb.key, displayName: fb.displayName });
  }
  for (const fa of a.functions) {
    const fb = mapB.get(fa.key);
    if (!fb) {
      removedFunctions.push({ key: fa.key, displayName: fa.displayName });
      continue;
    }
    const linesA = semantic ? normalizeWatLines(fa.lines) : fa.lines;
    const linesB = semantic ? normalizeWatLines(fb.lines) : fb.lines;
    const diff = unifiedDiff(linesA, linesB, 2);
    const addedLines = diff.filter((l) => l.startsWith('+')).length;
    const removedLines = diff.filter((l) => l.startsWith('-')).length;
    if (diff.length === 0) {
      unchangedFunctions.push({ key: fa.key, displayName: fa.displayName });
    } else {
      changedFunctions.push({
        key: fa.key,
        displayName: fa.displayName,
        unifiedDiff: diff,
        addedLines,
        removedLines,
      });
    }
  }

  return {
    addedFunctions,
    removedFunctions,
    changedFunctions,
    unchangedFunctions,
    importDelta: setDelta(a.imports, b.imports),
    exportDelta: setDelta(a.exports, b.exports),
    summary: {
      functionsA: a.functions.length,
      functionsB: b.functions.length,
      added: addedFunctions.length,
      removed: removedFunctions.length,
      changed: changedFunctions.length,
      unchanged: unchangedFunctions.length,
    },
  };
}

function setDelta(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    added: b.filter((x) => !setA.has(x)),
    removed: a.filter((x) => !setB.has(x)),
  };
}
