/**
 * Script search primitives for `ScriptManager`.
 *
 * This module's whole job is compiling a caller-supplied search term into a
 * matcher and walking script sources with it, so the `RegExp` constructor calls
 * below are the feature rather than a hazard: the literal path escapes every
 * metacharacter before compiling, and the regex path is the caller's explicit
 * opt-in. Keeping them here (rather than inline in the manager) makes that
 * boundary explicit.
 */

import { setImmediate as waitForImmediate } from 'node:timers/promises';
import {
  SCRIPT_CONTEXT_TRUNCATE_LINES_LARGE,
  SCRIPT_CONTEXT_SNIPPET_HALF_LINES_LARGE,
} from '@src/constants';

/** Lines between cooperative yields inside one script scan. */
export const SEARCH_LINE_YIELD_INTERVAL = 250;
/** Scripts between cooperative yields across the whole search. */
export const SEARCH_SCRIPT_YIELD_INTERVAL = 10;

/** One hit from searchInScripts. */
export interface ScriptSearchMatch {
  scriptId: string;
  url: string;
  line: number;
  column: number;
  matchText: string;
  context: string;
}

/**
 * Build the search regex. A literal keyword is escaped so regex metacharacters
 * in the user's text match themselves; `g` is required by `matchAll`.
 */
export function buildSearchRegex(
  keyword: string,
  isRegex: boolean,
  caseSensitive: boolean,
): RegExp {
  if (isRegex) {
    return caseSensitive ? new RegExp(keyword, 'g') : new RegExp(keyword, 'gi');
  }
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return caseSensitive ? new RegExp(escaped, 'g') : new RegExp(escaped, 'gi');
}

/** Everything one script scan needs from the caller. */
export interface ScriptScanArgs {
  script: { scriptId: string; url: string; source?: string };
  searchRegex: RegExp;
  contextLines: number;
  maxMatches: number;
  /** Accumulator shared across scripts; appended to in place. */
  matches: ScriptSearchMatch[];
  checkCancellation: () => void;
}

/**
 * Scan one script's source, appending hits to `matches`.
 *
 * Cancellation and yielding happen at exactly the points the inline loop in
 * `ScriptManager` used: before each line, every 256 accumulated matches, and
 * every SEARCH_LINE_YIELD_INTERVAL lines. Moving this body out must not change
 * when those fire — the deadline tests assert on the resulting CDP call counts.
 */
export async function scanScriptSource(args: ScriptScanArgs): Promise<void> {
  const { script, searchRegex, contextLines, maxMatches, matches, checkCancellation } = args;
  const lines = script.source!.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    for (const match of line.matchAll(searchRegex)) {
      if (matches.length >= maxMatches) break;
      if (matches.length % 256 === 0) {
        await waitForImmediate();
        checkCancellation();
      }

      const context = getContextWindow(
        lines,
        line,
        i,
        match.index || 0,
        contextLines,
        SCRIPT_CONTEXT_TRUNCATE_LINES_LARGE,
        SCRIPT_CONTEXT_SNIPPET_HALF_LINES_LARGE,
      );

      matches.push({
        scriptId: script.scriptId,
        url: script.url || 'inline',
        line: i + 1,
        column: match.index || 0,
        matchText: match[0],
        context,
      });
      if (matches.length >= maxMatches) break;
    }

    if (matches.length >= maxMatches) break;

    if ((i + 1) % SEARCH_LINE_YIELD_INTERVAL === 0) {
      await waitForImmediate();
      checkCancellation();
    }
  }
}

/**
 * Build the context string shown around a match.
 *
 * Over `truncateChars` the whole window is replaced by a centred snippet of the
 * matching line, so a match inside a minified bundle does not paste megabytes
 * into the response.
 */
export function getContextWindow(
  lines: string[],
  line: string,
  lineIndex: number,
  matchIndex: number,
  halfWidth: number,
  truncateChars: number,
  snippetHalfWidth: number,
): string {
  const startLine = Math.max(0, lineIndex - halfWidth);
  const endLine = Math.min(lines.length - 1, lineIndex + halfWidth);
  let contextLength = endLine - startLine;
  for (let i = startLine; i <= endLine && contextLength <= truncateChars; i++) {
    contextLength += lines[i]!.length;
  }

  if (contextLength > truncateChars) {
    const snippetStart = Math.max(0, matchIndex - snippetHalfWidth);
    const snippetEnd = Math.min(line.length, matchIndex + snippetHalfWidth);
    return (
      (snippetStart > 0 ? '...' : '') +
      line.substring(snippetStart, snippetEnd) +
      (snippetEnd < line.length ? '...' : '')
    );
  }

  return lines.slice(startLine, endLine + 1).join('\n');
}
