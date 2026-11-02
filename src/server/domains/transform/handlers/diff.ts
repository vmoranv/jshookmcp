import { diffLines } from 'diff';

export interface LineDiffOptions {
  maxLcsCells: number;
  fallback?: (oldLines: string[], newLines: string[]) => string;
}

/**
 * Build a unified line-level diff between `original` and `transformed`.
 *
 * Uses the `diff` package (Myers O(ND) algorithm) with a budget guard
 * (`maxEditLength`) and a wall-clock timeout. When the edit distance exceeds
 * the budget, the call returns `undefined`; we then fall back to a cheap
 * prefix/suffix-aware line diff that avoids the O(n*m) blowup entirely.
 *
 * Output: lines prefixed with ` ` (context), `+` (added), `-` (removed).
 * Prefix/suffix context is identified automatically by Myers' extractCommon;
 * the manual trim the previous hand-rolled LCS did is no longer needed.
 */
export function buildLineDiff(
  original: string,
  transformed: string,
  options: LineDiffOptions,
): string {
  if (original === transformed) return '';

  const oldLines = original.split('\n');
  const newLines = transformed.split('\n');
  const fallback = options.fallback ?? buildFallbackLineDiff;

  let prefixEnd = 0;
  while (
    prefixEnd < oldLines.length &&
    prefixEnd < newLines.length &&
    oldLines[prefixEnd] === newLines[prefixEnd]
  ) {
    prefixEnd += 1;
  }

  let oldSuffixStart = oldLines.length;
  let newSuffixStart = newLines.length;
  while (
    oldSuffixStart > prefixEnd &&
    newSuffixStart > prefixEnd &&
    oldLines[oldSuffixStart - 1] === newLines[newSuffixStart - 1]
  ) {
    oldSuffixStart -= 1;
    newSuffixStart -= 1;
  }

  const oldMiddle = oldLines.slice(prefixEnd, oldSuffixStart);
  const newMiddle = newLines.slice(prefixEnd, newSuffixStart);

  // Keep the cell budget guard: the legacy `maxLcsCells` bound is a cell count
  // (m*n), which `diff`'s `maxEditLength` (edit-distance bound) cannot express.
  // Cheap pre-check routes oversized middles to the fallback before we ever
  // allocate a Myers diff. `maxEditLength` + `timeout` below remain as a
  // second, stronger line of defense for adversarial inputs.
  if (exceedsCellBudget(oldMiddle.length, newMiddle.length, options.maxLcsCells)) {
    return fallback(oldLines, newLines);
  }

  const changes = diffLines(oldMiddle.join('\n'), newMiddle.join('\n'), {
    maxEditLength: options.maxLcsCells,
    timeout: 1000,
  });

  // Defensive: after the cell-budget pre-check above, `maxEditLength` can only
  // trip on degenerate inputs; `timeout` is the real backstop. `diffLines`
  // returns undefined when either fires — route to the cheap fallback.
  if (changes === undefined) {
    return fallback(oldLines, newLines);
  }

  const diffLinesOut: string[] = [];
  for (let i = 0; i < prefixEnd; i++) diffLinesOut.push(` ${oldLines[i]}`);
  for (const change of changes) {
    const prefix = change.added ? '+' : change.removed ? '-' : ' ';
    // `change.value` carries a trailing newline on every line except possibly
    // the last; strip the trailing newline and re-prefix each line.
    const lines = change.value.replace(/\n$/, '').split('\n');
    for (const line of lines) {
      diffLinesOut.push(prefix + line);
    }
  }
  for (let i = oldSuffixStart; i < oldLines.length; i++) diffLinesOut.push(` ${oldLines[i]}`);
  return diffLinesOut.join('\n');
}

function buildFallbackLineDiff(oldLines: string[], newLines: string[]): string {
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const removed = oldLines.slice(start, oldEnd + 1).map((line) => `-${line}`);
  const added = newLines.slice(start, newEnd + 1).map((line) => `+${line}`);
  return [...removed, ...added].join('\n');
}

function exceedsCellBudget(m: number, n: number, maxCells: number): boolean {
  return m > 0 && n > Math.floor(maxCells / m);
}
