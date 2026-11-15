/**
 * Centralized runtime-tunable constants for the jadx-search domain.
 *
 * Every value can be overridden via the corresponding env var (loaded
 * from `.env` at startup) — mirrors the project-wide constants pattern.
 *
 * @see openspec/changes/add-jadx-search-code/design.md §4
 */
import { readEnvInteger as int, readEnvString as str } from '@src/config/environment';

/**
 * Hard ceiling on the total number of matches returned across all files.
 * Excess matches set `truncated: true` on the result. Default: 500.
 *
 * Lower than the design's 1000 ceiling on purpose — single-shot tools that
 * return a few hundred matches already fill a typical LLM context window.
 */
export const JADX_SEARCH_MAX_RESULTS = int('JADX_SEARCH_MAX_RESULTS', 500);

/**
 * Default number of context lines emitted before and after each match.
 * Tools that want raw matches pass `contextLines: 0`. Default: 2.
 */
export const JADX_SEARCH_DEFAULT_CONTEXT_LINES = int('JADX_SEARCH_DEFAULT_CONTEXT_LINES', 2);

/**
 * Hard ceiling on `contextLines`. The MCP inputSchema also enforces this
 * cap; keep them in sync if changing. Default: 50 (change
 * `close-descoped-behaviors` raised it from 20 to match the blueprint).
 */
export const JADX_SEARCH_MAX_CONTEXT_LINES = int('JADX_SEARCH_MAX_CONTEXT_LINES', 50);

/**
 * Per-file match cap. After this many matches are recorded for a single
 * file the engine stops emitting more from that file (but keeps scanning
 * other files). Default: 100.
 */
export const JADX_SEARCH_MAX_MATCHES_PER_FILE = int('JADX_SEARCH_MAX_MATCHES_PER_FILE', 100);

/**
 * Total wall-clock budget for a single jadx_search_code call (engine-side,
 * excludes MCP transport overhead). Default: 60 s.
 */
export const JADX_SEARCH_TIMEOUT_MS = int('JADX_CODE_SEARCH_TIMEOUT_MS', 60_000);

/**
 * Post-hoc per-match regex test budget for the Node fallback engine. When a
 * single `.test()` exceeds this budget the engine aborts with a
 * `ToolError('TIMEOUT')`. The primary defence is the compile-time ReDoS
 * heuristic, this is the runtime safety net. Default: 50 ms.
 */
export const JADX_SEARCH_REGEX_TIMEOUT_MS = int('JADX_SEARCH_REGEX_TIMEOUT_MS', 50);

/**
 * Cap on the user-supplied query string length, in characters. Limits
 * both regex compilation cost and the ReDoS surface. Default: 1024.
 */
export const JADX_SEARCH_MAX_QUERY_LENGTH = int('JADX_SEARCH_MAX_QUERY_LENGTH', 1024);

/**
 * Maximum number of files the Node fallback engine will enumerate from
 * the decompile directory before bailing. Hardens against accidentally
 * pointing the tool at the filesystem root. Default: 50_000.
 */
export const JADX_SEARCH_FALLBACK_FILE_LIMIT = int('JADX_SEARCH_FALLBACK_FILE_LIMIT', 50_000);

/**
 * Cap on the cumulative stdout buffer accepted from a ripgrep child
 * process before the engine kills it. Default: 128 MiB.
 */
export const JADX_SEARCH_RG_MAX_BUFFER_BYTES = int(
  'JADX_SEARCH_RG_MAX_BUFFER_BYTES',
  128 * 1024 * 1024,
);

/**
 * Default file glob applied when the caller omits `globs`. Comma-separated
 * list — each entry passed as a separate `--glob` arg to ripgrep. Defaults
 * to scanning `.java` and `.kt` (Kotlin) sources, the two surface
 * languages jadx can decompile.
 */
export const JADX_SEARCH_DEFAULT_GLOBS = str(
  'JADX_SEARCH_DEFAULT_GLOBS',
  '**/*.java,**/*.kt',
).split(',');

/**
 * Maximum single line length the fallback engine will buffer when reading
 * a file. Lines longer than this are split silently. Default: 64 KiB —
 * far above any normal Java source line.
 */
export const JADX_SEARCH_MAX_LINE_BYTES = int('JADX_SEARCH_MAX_LINE_BYTES', 64 * 1024);

/**
 * Root directory for the content-addressed APK decompile cache (B-phase,
 * change `close-descoped-behaviors`). Relative paths resolve against the
 * process cwd. Default: `<os.tmpdir()>/jshook-jadx-cache`.
 */
export const JADX_SEARCH_CACHE_ROOT = str('JADX_SEARCH_CACHE_ROOT', '');

/**
 * Max age of a cached decompile result, in ms. Entries older than this are
 * rebuilt on the next `apkPath` call. Default: 7 days.
 */
export const JADX_SEARCH_CACHE_MAX_AGE_MS = int(
  'JADX_SEARCH_CACHE_MAX_AGE_MS',
  7 * 24 * 60 * 60 * 1000,
);
