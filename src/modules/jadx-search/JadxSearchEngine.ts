/**
 * jadx-search engine — read-only search across an existing jadx
 * decompile directory.
 *
 * Triggering a new decompilation is intentionally out of scope. Callers
 * should use the `binary-instrument` domain's jadx tools to produce the
 * sources first; this engine only scans them. See the
 * `add-jadx-search-code` change in `openspec/` for the contract.
 *
 * Workflow:
 *   1. Validate inputs (decompileDir exists, query non-empty, etc.).
 *   2. Detect ripgrep availability and dispatch to either engine.
 *   3. Wrap the engine outcome with timing/identity metadata.
 */

import { promises as fs } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { ToolError } from '@errors/ToolError';

import {
  JADX_SEARCH_DEFAULT_CONTEXT_LINES,
  JADX_SEARCH_DEFAULT_GLOBS,
  JADX_SEARCH_MAX_CONTEXT_LINES,
  JADX_SEARCH_MAX_MATCHES_PER_FILE,
  JADX_SEARCH_MAX_QUERY_LENGTH,
  JADX_SEARCH_MAX_RESULTS,
} from './constants';
import { NodeFallbackEngine } from './node-fallback-engine';
import { detectRipgrep, type RipgrepProbeResult } from './ripgrep-detector';
import { RipgrepEngine } from './ripgrep-engine';
import type {
  EngineRunOutcome,
  JadxSearchEngineKind,
  JadxSearchOptions,
  JadxSearchResult,
  NormalizedSearchOptions,
} from './types';

export interface JadxSearchEngineDeps {
  readonly ripgrep?: RipgrepEngine;
  readonly fallback?: NodeFallbackEngine;
  readonly probe?: () => Promise<RipgrepProbeResult>;
}

export class JadxSearchEngine {
  private readonly rg: RipgrepEngine;
  private readonly fallback: NodeFallbackEngine;
  private readonly probe: () => Promise<RipgrepProbeResult>;

  constructor(deps: JadxSearchEngineDeps = {}) {
    this.rg = deps.ripgrep ?? new RipgrepEngine();
    this.fallback = deps.fallback ?? new NodeFallbackEngine();
    this.probe = deps.probe ?? (() => detectRipgrep());
  }

  async search(opts: JadxSearchOptions): Promise<JadxSearchResult> {
    const normalized = await this.validateAndNormalize(opts);

    const start = performance.now();
    let engine: JadxSearchEngineKind = 'node-fallback';
    let outcome: EngineRunOutcome;
    if (!opts.forceFallback) {
      const probeResult = await this.probe();
      if (probeResult.available) {
        engine = 'ripgrep';
        try {
          outcome = await this.rg.run(normalized);
        } catch (err) {
          // ripgrep spawn failure → fall back to Node so the caller still
          // gets a usable result. We propagate VALIDATION errors (bad
          // regex etc.) so the user can correct the query.
          if (err instanceof ToolError && err.code === 'VALIDATION') {
            throw err;
          }
          engine = 'node-fallback';
          outcome = await this.fallback.run(normalized);
        }
      } else {
        outcome = await this.fallback.run(normalized);
      }
    } else {
      outcome = await this.fallback.run(normalized);
    }
    const durationMs = Math.round(performance.now() - start);

    const result: JadxSearchResult = {
      matches: outcome.matches,
      filesMatched: outcome.filesMatched,
      totalMatches: outcome.matches.length,
      engine,
      decompileDir: normalized.decompileDir,
      durationMs,
    };
    if (outcome.truncated) result.truncated = true;
    return result;
  }

  private async validateAndNormalize(opts: JadxSearchOptions): Promise<NormalizedSearchOptions> {
    if (typeof opts.decompileDir !== 'string' || opts.decompileDir.length === 0) {
      throw new ToolError('VALIDATION', 'decompileDir must be a non-empty string');
    }
    if (typeof opts.query !== 'string' || opts.query.length === 0) {
      throw new ToolError('VALIDATION', 'query must be a non-empty string');
    }
    if (opts.query.length > JADX_SEARCH_MAX_QUERY_LENGTH) {
      throw new ToolError(
        'VALIDATION',
        `query length ${opts.query.length} exceeds JADX_SEARCH_MAX_QUERY_LENGTH (${JADX_SEARCH_MAX_QUERY_LENGTH})`,
      );
    }

    const contextLines = opts.contextLines ?? JADX_SEARCH_DEFAULT_CONTEXT_LINES;
    if (!Number.isFinite(contextLines) || contextLines < 0 || !Number.isInteger(contextLines)) {
      throw new ToolError('VALIDATION', 'contextLines must be a non-negative integer');
    }
    if (contextLines > JADX_SEARCH_MAX_CONTEXT_LINES) {
      throw new ToolError(
        'VALIDATION',
        `contextLines ${contextLines} exceeds JADX_SEARCH_MAX_CONTEXT_LINES (${JADX_SEARCH_MAX_CONTEXT_LINES})`,
      );
    }

    const maxMatchesPerFile = opts.maxMatchesPerFile ?? JADX_SEARCH_MAX_MATCHES_PER_FILE;
    if (
      !Number.isFinite(maxMatchesPerFile) ||
      maxMatchesPerFile < 1 ||
      !Number.isInteger(maxMatchesPerFile)
    ) {
      throw new ToolError('VALIDATION', 'maxMatchesPerFile must be a positive integer');
    }

    const maxResults = opts.maxResults ?? JADX_SEARCH_MAX_RESULTS;
    if (!Number.isFinite(maxResults) || maxResults < 1 || !Number.isInteger(maxResults)) {
      throw new ToolError('VALIDATION', 'maxResults must be a positive integer');
    }

    const absoluteDir = resolvePath(opts.decompileDir);
    let stat;
    try {
      stat = await fs.stat(absoluteDir);
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `decompileDir not found: ${absoluteDir}`, {
        cause: cause as Error,
        details: { decompileDir: absoluteDir },
      });
    }
    if (!stat.isDirectory()) {
      throw new ToolError('VALIDATION', `decompileDir is not a directory: ${absoluteDir}`);
    }

    const globs =
      opts.globs && opts.globs.length > 0 ? Array.from(opts.globs) : [...JADX_SEARCH_DEFAULT_GLOBS];

    return {
      decompileDir: absoluteDir,
      query: opts.query,
      globs,
      literal: opts.literal === true,
      caseInsensitive: opts.caseInsensitive === true,
      contextLines,
      maxMatchesPerFile,
      maxResults,
    };
  }
}
