import * as parser from '@babel/parser';
import traverse from '@babel/traverse';

interface ProtectedRange {
  start: number;
  end: number;
}

type SafeReplaceCallback = (match: string, ...args: any[]) => string;

const REGEX_OPENER_PREV = new Set([
  '=',
  '(',
  '[',
  ',',
  ';',
  '{',
  '!',
  '&',
  '|',
  '?',
  ':',
  '~',
  '^',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '\n',
]);

function cloneRegex(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

function mergeProtectedRanges(ranges: ProtectedRange[]): ProtectedRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const merged: ProtectedRange[] = [];
  const sorted = ranges.toSorted((a, b) => a.start - b.start || a.end - b.end);
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
      continue;
    }
    last.end = Math.max(last.end, range.end);
  }
  return merged;
}

function collectProtectedRangesWithAst(code: string): ProtectedRange[] | null {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
    const ranges: ProtectedRange[] = [];
    const pushRange = (start: number | null | undefined, end: number | null | undefined) => {
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        ranges.push({ start, end });
      }
    };

    const comments = Array.isArray(
      (ast as { comments?: Array<{ start?: number; end?: number }> }).comments,
    )
      ? (ast as { comments: Array<{ start?: number; end?: number }> }).comments
      : [];
    for (const comment of comments) {
      pushRange(comment.start, comment.end);
    }

    traverse(ast, {
      StringLiteral(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
      TemplateElement(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
      RegExpLiteral(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
    });

    return mergeProtectedRanges(ranges);
  } catch {
    return null;
  }
}

function getReplaceCallbackOffset(args: unknown[]): number | null {
  const maybeOffset = args[args.length - 2];
  if (typeof maybeOffset === 'number') {
    return maybeOffset;
  }

  const fallbackOffset = args[args.length - 3];
  return typeof fallbackOffset === 'number' ? fallbackOffset : null;
}

function isRegexOpener(code: string, pos: number): boolean {
  let prevIndex = pos - 1;
  while (
    prevIndex >= 0 &&
    (code[prevIndex] === ' ' || code[prevIndex] === '\t' || code[prevIndex] === '\r')
  ) {
    prevIndex--;
  }

  if (prevIndex < 0) {
    return true;
  }

  const prev = code[prevIndex]!;
  if (REGEX_OPENER_PREV.has(prev)) {
    return true;
  }

  if (prev !== ')') {
    return false;
  }

  let depth = 1;
  let keywordIndex = prevIndex - 1;
  while (keywordIndex >= 0 && depth > 0) {
    if (code[keywordIndex] === ')') {
      depth++;
    }
    if (code[keywordIndex] === '(') {
      depth--;
    }
    keywordIndex--;
  }

  keywordIndex--;
  while (keywordIndex >= 0 && (code[keywordIndex] === ' ' || code[keywordIndex] === '\t')) {
    keywordIndex--;
  }

  let keyword = '';
  while (keywordIndex >= 0 && /[a-z]/.test(code[keywordIndex]!)) {
    keyword = code[keywordIndex]! + keyword;
    keywordIndex--;
  }

  return ['if', 'while', 'for', 'switch', 'return', 'typeof', 'void', 'in', 'of', 'case'].includes(
    keyword,
  );
}

/** Mutable scanner state shared by the state-machine step functions. */
interface LexicalScanState {
  inStr: "'" | '"' | '`' | null;
  inBlockComment: boolean;
  inLineComment: boolean;
  inRegex: boolean;
}

function insideStringLiteralOrComment(code: string, offset: number): boolean {
  const st: LexicalScanState = {
    inStr: null,
    inBlockComment: false,
    inLineComment: false,
    inRegex: false,
  };

  let index = 0;
  while (index < offset) {
    index = stepLexicalScan(code, offset, index, st);
  }

  return st.inStr !== null || st.inBlockComment || st.inLineComment || st.inRegex;
}

/** Advance `index` past a regex body + flags; returns the new index. */
function skipRegexBody(code: string, offset: number, index: number): number {
  index++;
  while (index < offset && /[gimsuy]/.test(code[index]!)) {
    index++;
  }
  return index;
}

/** Advance `index` past a regex character class ([...]); returns the new index. */
function skipRegexClass(code: string, offset: number, index: number): number {
  index++;
  while (index < offset && code[index] !== ']') {
    if (code[index] === '\\') {
      index++;
    }
    index++;
  }
  return index;
}

/** One state-machine step of the lexical scanner (comment/string/regex). */
function stepLexicalScan(
  code: string,
  offset: number,
  index: number,
  st: LexicalScanState,
): number {
  const char = code[index]!;
  if (st.inBlockComment) {
    if (char === '*' && code[index + 1] === '/') {
      st.inBlockComment = false;
      return index + 2;
    }
    return index + 1;
  }
  if (st.inLineComment) {
    if (char === '\n') {
      st.inLineComment = false;
    }
    return index + 1;
  }
  if (st.inRegex) {
    if (char === '\\') return index + 2;
    if (char === '/') {
      st.inRegex = false;
      return skipRegexBody(code, offset, index);
    }
    if (char === '[') return skipRegexClass(code, offset, index);
    return index + 1;
  }
  if (st.inStr) {
    if (char === '\\') return index + 2;
    if (char === st.inStr) {
      st.inStr = null;
    }
    return index + 1;
  }
  if (char === '/' && code[index + 1] === '/') {
    st.inLineComment = true;
    return index + 2;
  }
  if (char === '/' && code[index + 1] === '*') {
    st.inBlockComment = true;
    return index + 2;
  }
  if (char === '/' && isRegexOpener(code, index)) {
    st.inRegex = true;
    return index + 1;
  }
  if (char === "'" || char === '"' || char === '`') {
    st.inStr = char;
  }
  return index + 1;
}

/**
 * Binary search over sorted, non-overlapping protected ranges. Returns true
 * when `offset` falls inside any range (`start <= offset < end`).
 */
function isOffsetInRanges(offset: number, ranges: ProtectedRange[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid]!;
    if (offset < range.start) {
      high = mid - 1;
    } else if (offset >= range.end) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Single-pass lexical fallback for {@link createProtectedRangeResolver} when
 * Babel parsing fails. Records string/comment/regex ranges in one O(n) scan so
 * `isProtected` can binary-search them instead of re-running the O(n) scanner
 * per match. Mirrors the state machine in {@link insideStringLiteralOrComment}.
 */
/** Line comment: `//` through the newline (exclusive) or EOF. */
function scanLineCommentRange(code: string, length: number, start: number): ProtectedRange {
  let index = start + 2;
  while (index < length && code[index] !== '\n') index += 1;
  return { start, end: index };
}

/** Block comment: `/*` through `*` + `/` (inclusive) or EOF. */
function scanBlockCommentRange(code: string, length: number, start: number): ProtectedRange {
  let index = start + 2;
  while (index < length && !(code[index] === '*' && code[index + 1] === '/')) index += 1;
  index = Math.min(index + 2, length);
  return { start, end: index };
}

/** String literal: quote through the matching close (respecting escapes). */
function scanStringRange(
  code: string,
  length: number,
  start: number,
  quote: string,
): ProtectedRange {
  let index = start + 1;
  while (index < length) {
    if (code[index] === '\\') {
      index += 2;
      continue;
    }
    if (code[index] === quote) {
      index += 1;
      break;
    }
    index += 1;
  }
  return { start, end: index };
}

/** Regex literal body + flags (only where a regex is syntactically valid). */
function scanRegexRange(code: string, length: number, start: number): ProtectedRange {
  let index = start + 1;
  let inClass = false;
  while (index < length) {
    const c = code[index]!;
    if (c === '\\') {
      index += 2;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      index += 1;
      continue;
    }
    if (c === '[') {
      inClass = true;
      index += 1;
      continue;
    }
    if (c === '/') {
      index += 1;
      while (index < length && /[gimsuy]/.test(code[index]!)) index += 1;
      break;
    }
    index += 1;
  }
  return { start, end: index };
}

function collectProtectedRangesLexical(code: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const length = code.length;
  let index = 0;

  while (index < length) {
    const char = code[index]!;

    if (char === '/' && code[index + 1] === '/') {
      const range = scanLineCommentRange(code, length, index);
      ranges.push(range);
      index = range.end;
      continue;
    }

    if (char === '/' && code[index + 1] === '*') {
      const range = scanBlockCommentRange(code, length, index);
      ranges.push(range);
      index = range.end;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      const range = scanStringRange(code, length, index, char);
      ranges.push(range);
      index = range.end;
      continue;
    }

    if (char === '/' && isRegexOpener(code, index)) {
      const range = scanRegexRange(code, length, index);
      ranges.push(range);
      index = range.end;
      continue;
    }

    index += 1;
  }

  return ranges;
}

export interface ProtectedRangeResolver {
  /** The code string these ranges were computed from (for staleness checks). */
  readonly source: string;
  /** Precomputed merged protected ranges (read-only), never null. */
  getRanges(): ProtectedRange[];
  /** Whether `offset` falls inside a protected range (binary search). */
  isProtected(offset: number): boolean;
}

/**
 * Parse `code` once and expose its protected ranges for reuse across many
 * replacement passes. Replaces the old per-call `collectProtectedRangesWithAst`
 * full re-parse (the solve-constraints pipeline called it ~18 times/request).
 * On Babel parse failure, falls back to a single lexical scan so `isProtected`
 * stays O(log n) instead of re-running the O(n) scanner per match.
 *
 * BEHAVIOR CHANGE: before the resolver, Babel parse failure was handled by the
 * per-match `insideStringLiteralOrComment` scanner in the
 * `replaceOutsideProtectedRanges` `protectedRanges === null` branch. With the
 * resolver, parse failure routes through `collectProtectedRangesLexical`, so
 * `getRanges()` is never null and that per-match branch is bypassed for
 * source-matching code. The two scanners are intended to be equivalent but are
 * distinct implementations. Secondary: the resolver's ranges only apply while
 * `resolver.source === code` (see {@link replaceOutsideProtectedRanges}); after
 * the first pass mutates the output, later passes re-parse, and if that parse
 * also fails they fall back to `insideStringLiteralOrComment` — so unparseable
 * code mixes the two scanners across passes.
 */
export function createProtectedRangeResolver(code: string): ProtectedRangeResolver {
  let ranges = collectProtectedRangesWithAst(code);
  if (ranges === null) {
    ranges = collectProtectedRangesLexical(code);
  }
  const merged = mergeProtectedRanges(ranges);
  return {
    source: code,
    getRanges: () => merged,
    isProtected: (offset) => isOffsetInRanges(offset, merged),
  };
}

export function replaceOutsideProtectedRanges(
  code: string,
  pattern: RegExp,
  replacement: string | SafeReplaceCallback,
  resolver?: ProtectedRangeResolver,
): string {
  const applyReplacement = (input: string): string =>
    typeof replacement === 'string'
      ? input.replace(cloneRegex(pattern), replacement)
      : input.replace(cloneRegex(pattern), replacement);
  // Reuse the resolver's ranges only when they were computed from this exact
  // code string; a mutated output has shifted offsets and must be re-parsed.
  // BEHAVIOR CHANGE: a source-matching resolver uses its precomputed ranges
  // (lexical when the parse failed), while the re-parse / no-resolver path on
  // parse failure uses the per-match `insideStringLiteralOrComment` scanner —
  // see {@link createProtectedRangeResolver}.
  const protectedRanges =
    resolver && resolver.source === code
      ? resolver.getRanges()
      : collectProtectedRangesWithAst(code);

  if (protectedRanges === null) {
    return code.replace(cloneRegex(pattern), (...args: unknown[]) => {
      const fullMatch = typeof args[0] === 'string' ? args[0] : '';
      const offset = getReplaceCallbackOffset(args);
      if (offset !== null && insideStringLiteralOrComment(code, offset)) {
        return fullMatch;
      }
      return typeof replacement === 'string'
        ? replacement
        : replacement(fullMatch, ...args.slice(1));
    });
  }

  if (protectedRanges.length === 0) {
    return applyReplacement(code);
  }

  let rewritten = '';
  let cursor = 0;
  for (const range of protectedRanges) {
    if (cursor < range.start) {
      rewritten += applyReplacement(code.slice(cursor, range.start));
    }
    rewritten += code.slice(range.start, range.end);
    cursor = range.end;
  }
  if (cursor < code.length) {
    rewritten += applyReplacement(code.slice(cursor));
  }
  return rewritten;
}
