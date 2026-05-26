/**
 * Type definitions for the jadx-search module.
 *
 * The module is intentionally read-only: it scans an *existing* jadx
 * decompile directory and returns matched code locations. Triggering a
 * new decompilation is out of scope — callers should use the
 * `binary-instrument` domain's jadx tools first.
 *
 * @see openspec/changes/add-jadx-search-code/design.md §3
 */

/** Which engine produced the search result. */
export type JadxSearchEngineKind = 'ripgrep' | 'node-fallback';

/**
 * A single matched code location.
 *
 * Paths are emitted relative to the supplied `decompileDir`, with
 * platform path separators normalised to forward slashes so the same
 * result shape works on Windows and POSIX hosts.
 */
export interface JadxMatch {
  /** Path relative to `decompileDir`, forward-slash normalised. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** 1-indexed byte column at which the match starts. */
  column: number;
  /** Full text of the matched line, trimmed of trailing newline. */
  text: string;
  /** 1-indexed column at which the match begins (inclusive). */
  matchStart: number;
  /** 1-indexed column at which the match ends (exclusive). */
  matchEnd: number;
  /**
   * Optional surrounding context. Present only when `contextLines > 0`.
   * `before` is ordered earliest → latest; `after` is ordered earliest →
   * latest. Each entry carries the file-relative line number so callers
   * can render full snippets without re-reading the file.
   */
  context?: {
    before: Array<{ line: number; text: string }>;
    after: Array<{ line: number; text: string }>;
  };
}

/**
 * Input options accepted by {@link JadxSearchEngine.search}.
 *
 * Only `decompileDir` and `query` are required. All other fields fall
 * back to module-level constants.
 */
export interface JadxSearchOptions {
  /** Absolute or relative path to the directory holding decompiled sources. */
  decompileDir: string;
  /** Search pattern. Treated as regex unless `literal: true`. */
  query: string;
  /**
   * File globs applied during enumeration. Defaults to scanning Java
   * (`**\/*.java`) and Kotlin (`**\/*.kt`) sources. Negative globs
   * starting with `!` are honoured by both engines.
   */
  globs?: readonly string[];
  /** Treat `query` as a literal string instead of a regex. Default: false. */
  literal?: boolean;
  /** Case-insensitive matching. Default: false. */
  caseInsensitive?: boolean;
  /**
   * Number of context lines emitted before and after each match. Capped
   * by {@link JADX_SEARCH_MAX_CONTEXT_LINES}. Default:
   * {@link JADX_SEARCH_DEFAULT_CONTEXT_LINES}.
   */
  contextLines?: number;
  /**
   * Per-file match cap. Default:
   * {@link JADX_SEARCH_MAX_MATCHES_PER_FILE}.
   */
  maxMatchesPerFile?: number;
  /**
   * Hard ceiling on total matches across all files. When hit, the
   * remainder is dropped and `truncated: true` is set on the result.
   * Default: {@link JADX_SEARCH_MAX_RESULTS}.
   */
  maxResults?: number;
  /**
   * Force the Node fallback engine even when ripgrep is available on
   * the host. Used by tests to exercise the fallback path. Default:
   * false.
   */
  forceFallback?: boolean;
}

/**
 * Final result returned by {@link JadxSearchEngine.search}.
 */
export interface JadxSearchResult {
  /** Aggregated matches across all scanned files (ordered by file, then line). */
  matches: JadxMatch[];
  /** Number of distinct files that contributed at least one match. */
  filesMatched: number;
  /** Total number of matches recorded (equals `matches.length`). */
  totalMatches: number;
  /** Which engine produced the result. */
  engine: JadxSearchEngineKind;
  /** Wall-clock duration of the search in milliseconds. */
  durationMs: number;
  /** Set when any per-file or total cap was hit. */
  truncated?: boolean;
  /**
   * The resolved absolute path of the decompile directory (after
   * `path.resolve`). Helpful when the caller passed a relative path.
   */
  decompileDir: string;
}

/**
 * Internal options for the lower-level engines. Both ripgrep and the
 * Node fallback accept this same struct; the dispatcher constructs it
 * from the public {@link JadxSearchOptions}.
 */
export interface NormalizedSearchOptions {
  readonly decompileDir: string;
  readonly query: string;
  readonly globs: readonly string[];
  readonly literal: boolean;
  readonly caseInsensitive: boolean;
  readonly contextLines: number;
  readonly maxMatchesPerFile: number;
  readonly maxResults: number;
}

/**
 * Internal raw output produced by either engine. The {@link JadxSearchEngine}
 * dispatcher wraps it in a {@link JadxSearchResult}.
 */
export interface EngineRunOutcome {
  matches: JadxMatch[];
  filesMatched: number;
  truncated: boolean;
}
