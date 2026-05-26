/**
 * Pure-Node fallback engine for {@link JadxSearchEngine}.
 *
 * Walks the decompile directory with `fs.promises.readdir({ recursive: true })`,
 * filters with a small glob matcher, and applies the search pattern
 * line-by-line. Significantly slower than ripgrep but available on any
 * machine that can run Node 22+. Used when:
 *   - ripgrep is not installed; or
 *   - The caller explicitly passes `forceFallback: true` (tests).
 *
 * Pattern safety is enforced by {@link compileSafePattern}, which mirrors
 * the dual red-line strategy documented in
 * `src/server/domains/dart-inspector/CLAUDE.md`:
 *
 *   1. Compile-time: reject obvious catastrophic-backtracking shapes
 *      (`(.+)+`, `(a|b)+c+`, …) before constructing a `RegExp`.
 *   2. Runtime: wrap every `.test()` invocation in a wall-clock guard;
 *      a single match exceeding {@link JADX_SEARCH_REGEX_TIMEOUT_MS}
 *      aborts the whole call.
 */

import { promises as fs } from 'node:fs';
import { posix, resolve as resolvePath, sep } from 'node:path';

import { ToolError } from '@errors/ToolError';

import {
  JADX_SEARCH_FALLBACK_FILE_LIMIT,
  JADX_SEARCH_MAX_LINE_BYTES,
  JADX_SEARCH_REGEX_TIMEOUT_MS,
} from './constants';
import type { EngineRunOutcome, JadxMatch, NormalizedSearchOptions } from './types';

/** Heuristics flagging obvious ReDoS shapes. Pairs with the runtime guard. */
const REDOS_HEURISTICS: readonly RegExp[] = Object.freeze([
  /\([^()]*[+*][^()]*\)[+*]/,
  /\([^()]*\|[^()]*\)[+*][^()]*[+*]/,
]);

function escapeForLiteral(source: string): string {
  return source.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * Build the regex used by the fallback engine. Visible for tests; throws
 * {@link ToolError}(`VALIDATION`) on unsafe / invalid patterns.
 */
export function compileSafePattern(
  query: string,
  literal: boolean,
  caseInsensitive: boolean,
): RegExp {
  const source = literal ? escapeForLiteral(query) : query;
  if (!literal) {
    for (const heuristic of REDOS_HEURISTICS) {
      if (heuristic.test(source)) {
        throw new ToolError(
          'VALIDATION',
          'query rejected as potentially catastrophic (ReDoS heuristic match)',
          { details: { query } },
        );
      }
    }
  }
  const flags = caseInsensitive ? 'gi' : 'g';
  try {
    return new RegExp(source, flags);
  } catch (cause) {
    throw new ToolError(
      'VALIDATION',
      `query failed to compile as regex: ${(cause as Error).message}`,
      { cause: cause as Error, details: { query } },
    );
  }
}

/** A glob pre-compiled to a RegExp + its `!`-negation flag. */
interface CompiledGlob {
  readonly negate: boolean;
  readonly re: RegExp;
}

/** Compile a glob list once for repeated use across many paths. */
export function compileGlobs(globs: readonly string[]): CompiledGlob[] {
  return globs.map((raw) => {
    const negate = raw.startsWith('!');
    const pattern = negate ? raw.slice(1) : raw;
    return { negate, re: globToRegExp(pattern) };
  });
}

/** Match a file path (relative, forward-slash) against pre-compiled globs. */
export function matchesCompiledGlobs(path: string, compiled: readonly CompiledGlob[]): boolean {
  let include = false;
  let hasPositive = false;
  for (const { negate, re } of compiled) {
    if (!negate) hasPositive = true;
    if (re.test(path)) {
      if (negate) return false;
      include = true;
    }
  }
  return hasPositive ? include : true;
}

/** Match a file path (relative, forward-slash) against a glob list. */
export function matchesGlobs(path: string, globs: readonly string[]): boolean {
  return matchesCompiledGlobs(path, compileGlobs(globs));
}

/** Standard RegExp metacharacters (excluding `*`, `?` which are glob ops). */
const REGEX_METACHARS = /[\\^$.+()|[\]{}]/;

/** Convert a Bash-style glob to a RegExp. Supports `*`, `**`, `?`. */
function globToRegExp(glob: string): RegExp {
  let out = '^';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 2;
        if (glob[i] === '/') i += 1;
        continue;
      }
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch !== undefined && REGEX_METACHARS.test(ch)) {
      out += '\\' + ch;
    } else if (ch === '/') {
      out += '/';
    } else if (ch !== undefined) {
      out += ch;
    }
    i += 1;
  }
  out += '$';
  return new RegExp(out);
}

function relativise(fullPath: string, baseDir: string): string {
  const norm = fullPath.split(sep).join('/');
  const base = baseDir.split(sep).join('/');
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return norm.startsWith(prefix) ? norm.slice(prefix.length) : norm;
}

function splitLines(content: string): string[] {
  // Preserve empty lines; strip the trailing newline from each entry.
  const lines = content.split(/\r?\n/);
  return lines;
}

function timedTest(re: RegExp, value: string, startIndex: number): RegExpExecArray | null {
  re.lastIndex = startIndex;
  const start = performance.now();
  const result = re.exec(value);
  const elapsed = performance.now() - start;
  if (elapsed > JADX_SEARCH_REGEX_TIMEOUT_MS) {
    throw new ToolError(
      'TIMEOUT',
      `Regex match exceeded JADX_SEARCH_REGEX_TIMEOUT_MS (${JADX_SEARCH_REGEX_TIMEOUT_MS} ms): ${elapsed.toFixed(2)} ms`,
      { details: { pattern: re.source, elapsedMs: elapsed } },
    );
  }
  return result;
}

/**
 * Enumerate candidate source files under `decompileDir`, honouring the
 * file-count cap. Visible for tests.
 */
export async function enumerateFiles(
  decompileDir: string,
  globs: readonly string[],
  limit: number = JADX_SEARCH_FALLBACK_FILE_LIMIT,
): Promise<string[]> {
  let results: string[];
  try {
    results = await fs.readdir(decompileDir, { recursive: true });
  } catch (cause) {
    throw new ToolError('NOT_FOUND', `decompileDir not readable: ${decompileDir}`, {
      cause: cause as Error,
    });
  }
  const compiled = compileGlobs(globs);
  const collected: string[] = [];
  for (const entry of results) {
    if (collected.length >= limit) break;
    const norm = entry.split(sep).join('/');
    if (!matchesCompiledGlobs(norm, compiled)) continue;
    // Skip directories — readdir(recursive) returns both directories
    // and files; we filter by attempting a stat below only when needed.
    collected.push(norm);
  }
  return collected;
}

export class NodeFallbackEngine {
  async run(opts: NormalizedSearchOptions): Promise<EngineRunOutcome> {
    const absDir = resolvePath(opts.decompileDir);
    const files = await enumerateFiles(absDir, opts.globs);
    const re = compileSafePattern(opts.query, opts.literal, opts.caseInsensitive);

    const matches: JadxMatch[] = [];
    const filesMatched = new Set<string>();
    let truncated = false;

    outer: for (const relPath of files) {
      const fullPath = posix.join(absDir.split(sep).join('/'), relPath);
      let content: string;
      try {
        content = await fs.readFile(fullPath, 'utf8');
      } catch {
        // Skip directories and unreadable entries silently.
        continue;
      }

      // Skip pathological lines silently so a single bad file cannot
      // OOM the engine.
      const lines = splitLines(content);
      let matchesThisFile = 0;
      const rel = relativise(fullPath, absDir);

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
        const text = lines[lineIdx];
        if (text === undefined) continue;
        if (text.length > JADX_SEARCH_MAX_LINE_BYTES) continue;
        // Walk every match on the line, tracking `pos` so we don't re-emit
        // the same match. `timedTest` honours the explicit startIndex.
        let pos = 0;
        let match = timedTest(re, text, pos);
        while (match !== null) {
          if (matchesThisFile >= opts.maxMatchesPerFile) {
            truncated = true;
            break;
          }
          const start = match.index + 1;
          const end = match.index + match[0].length + 1;
          const built: JadxMatch = {
            file: rel,
            line: lineIdx + 1,
            column: start,
            text,
            matchStart: start,
            matchEnd: end,
          };
          if (opts.contextLines > 0) {
            const before: Array<{ line: number; text: string }> = [];
            for (let b = Math.max(0, lineIdx - opts.contextLines); b < lineIdx; b += 1) {
              const t = lines[b];
              if (t !== undefined) before.push({ line: b + 1, text: t });
            }
            const after: Array<{ line: number; text: string }> = [];
            for (
              let a = lineIdx + 1;
              a < Math.min(lines.length, lineIdx + 1 + opts.contextLines);
              a += 1
            ) {
              const t = lines[a];
              if (t !== undefined) after.push({ line: a + 1, text: t });
            }
            built.context = { before, after };
          }
          matches.push(built);
          filesMatched.add(rel);
          matchesThisFile += 1;
          if (matches.length >= opts.maxResults) {
            truncated = true;
            break outer;
          }
          // Advance past this match. For zero-width matches, step forward
          // one character to avoid an infinite loop.
          const consumed = match[0].length;
          pos = match.index + (consumed > 0 ? consumed : 1);
          if (pos > text.length) break;
          match = timedTest(re, text, pos);
        }
      }
    }

    return {
      matches,
      filesMatched: filesMatched.size,
      truncated,
    };
  }
}
