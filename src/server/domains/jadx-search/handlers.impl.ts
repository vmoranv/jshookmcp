/**
 * jadx-search domain — single tool handler that delegates to the
 * {@link JadxSearchEngine} module.
 *
 * Responsibilities:
 *  - Type-safe argument extraction via `parseArgs` utilities.
 *  - Forward normalised options to the module; the module handles
 *    validation, engine selection (ripgrep vs Node fallback), and
 *    result shaping.
 *  - Wrap the result in the standard MCP envelope via {@link handleSafe}.
 *
 * No decompilation logic lives here — the tool is read-only by design.
 */

import { ToolError } from '@errors/ToolError';
import { JadxSearchEngine } from '@modules/jadx-search';
import type { JadxSearchOptions } from '@modules/jadx-search';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import {
  argBool,
  argNumber,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import type { ToolResponse } from '@server/types';

export class JadxSearchHandlers {
  private readonly engine: JadxSearchEngine;

  constructor(engine: JadxSearchEngine = new JadxSearchEngine()) {
    this.engine = engine;
  }

  handleJadxSearchCode(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const decompileDir = argStringRequired(args, 'decompileDir');
      const query = argStringRequired(args, 'query');

      // Explicitly reject apkPath even though the schema omits it — older
      // proposals listed it as a planned input; this tool intentionally
      // does not trigger a new decompilation.
      if (typeof args['apkPath'] === 'string' && (args['apkPath'] as string).length > 0) {
        throw new ToolError(
          'VALIDATION',
          'apkPath is not supported by jadx_search_code (read-only). ' +
            'Run jadx via the binary-instrument domain first, then pass decompileDir.',
        );
      }

      const opts: JadxSearchOptions = {
        decompileDir,
        query,
      };

      const literal = argBool(args, 'literal');
      if (literal !== undefined) opts.literal = literal;
      const caseInsensitive = argBool(args, 'caseInsensitive');
      if (caseInsensitive !== undefined) opts.caseInsensitive = caseInsensitive;
      const contextLines = argNumber(args, 'contextLines');
      if (contextLines !== undefined) opts.contextLines = contextLines;
      const maxMatchesPerFile = argNumber(args, 'maxMatchesPerFile');
      if (maxMatchesPerFile !== undefined) opts.maxMatchesPerFile = maxMatchesPerFile;
      const maxResults = argNumber(args, 'maxResults');
      if (maxResults !== undefined) opts.maxResults = maxResults;

      const rawGlobs = args['globs'];
      if (rawGlobs !== undefined) {
        if (!Array.isArray(rawGlobs)) {
          throw new ToolError('VALIDATION', 'globs must be an array of strings');
        }
        const globs = argStringArray(args, 'globs');
        if (globs.length !== rawGlobs.length) {
          throw new ToolError('VALIDATION', 'globs contains non-string entries');
        }
        if (globs.length > 0) opts.globs = globs;
      }

      const result = await this.engine.search(opts);
      return {
        matches: result.matches,
        filesMatched: result.filesMatched,
        totalMatches: result.totalMatches,
        engine: result.engine,
        durationMs: result.durationMs,
        decompileDir: result.decompileDir,
        ...(result.truncated ? { truncated: true } : {}),
      };
    });
  }
}
