/**
 * ToolCallContextGuard — enriches tool responses with current tab context
 * and detects repeated tool call loops.
 *
 * For context-sensitive tools (page_*, console_*, debugger_*, network_*, dom_*, etc.),
 * appends `_tabContext` metadata to responses so the LLM always knows which page
 * it is operating on, preventing silent context drift.
 *
 * Additionally, tracks consecutive identical tool calls and injects `_repeatWarning`
 * when the same tool is called ≥ MAX_CONSECUTIVE_REPEATS times in a row, helping
 * break LLM degeneration loops (e.g. stealth_inject called 5× instead of page_navigate).
 */

import { logger } from '@utils/logger';

/** Minimal TabRegistry surface needed by the guard. */
interface TabContextProvider {
  getContextMeta(): {
    url: string | null;
    title: string | null;
    tabIndex: number | null;
    pageId: string | null;
  };
}

type ContextSensitiveToolDomain =
  | 'page'
  | 'console'
  | 'debugger'
  | 'network'
  | 'dom'
  | 'stealth'
  | 'framework'
  | 'indexeddb'
  | 'js_heap'
  | 'script'
  | 'captcha';

type ContextSensitiveToolPrefix = `${ContextSensitiveToolDomain}_`;

const CONTEXT_SENSITIVE_PREFIXES = [
  'page_',
  'console_',
  'debugger_',
  'network_',
  'dom_',
  'stealth_',
  'framework_',
  'indexeddb_',
  'js_heap_',
  'script_',
  'captcha_',
] as const satisfies readonly ContextSensitiveToolPrefix[];

/** Max consecutive identical calls before injecting a warning. */
const MAX_CONSECUTIVE_REPEATS = 3;

/** Meta-tools excluded from repeat detection — agents legitimately chain these. */
const REPEAT_GUARD_EXCLUDES = new Set([
  'search_tools',
  'route_tool',
  'describe_tool',
  'call_tool',
  'activate_tools',
  'deactivate_tools',
  'activate_domain',
]);

/** Suggested alternative tools per domain prefix when a repeat loop is detected. */
const DOMAIN_ALTERNATIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ['stealth', ['page_navigate', 'page_screenshot', 'stealth_verify']],
  ['page', ['dom_get_structure', 'page_screenshot', 'console_get_logs']],
  ['console', ['page_evaluate', 'page_screenshot']],
  ['network', ['network_get_requests', 'page_navigate']],
  ['captcha', ['captcha_wait', 'page_screenshot']],
]);

export class ToolCallContextGuard {
  /** Memoize prefix-match results — tool names repeat heavily across calls. */
  private readonly contextSensitiveCache = new Map<string, boolean>();

  /** Ring buffer tracking the last tool call name for repeat detection. */
  private lastToolName: string | null = null;
  private consecutiveCount = 0;

  constructor(private getProvider: () => TabContextProvider | null) {}

  /** Check whether a tool name belongs to a context-sensitive domain. */
  isContextSensitive(toolName: string): boolean {
    const cached = this.contextSensitiveCache.get(toolName);
    if (cached !== undefined) return cached;

    const result = CONTEXT_SENSITIVE_PREFIXES.some((p) => toolName.startsWith(p));
    this.contextSensitiveCache.set(toolName, result);
    return result;
  }

  /**
   * Record a tool call for repeat detection.
   * Call this BEFORE enrichResponse for accurate tracking.
   * Returns the current consecutive count (1 = first call).
   */
  recordCall(toolName: string): number {
    if (REPEAT_GUARD_EXCLUDES.has(toolName)) {
      // Don't track meta-tools — they chain legitimately
      return 0;
    }

    if (toolName === this.lastToolName) {
      this.consecutiveCount++;
    } else {
      this.lastToolName = toolName;
      this.consecutiveCount = 1;
    }
    return this.consecutiveCount;
  }

  /**
   * Check if the current call is a suspected repeat loop.
   */
  isRepeatLoop(): boolean {
    return this.consecutiveCount >= MAX_CONSECUTIVE_REPEATS;
  }

  /**
   * Enrich a successful tool response with `_tabContext` metadata.
   *
   * Uses string splice injection to avoid a full JSON.parse → JSON.stringify
   * round-trip on the hot path. Falls back to parse+mutate only for non-object
   * JSON payloads.
   */
  enrichResponse<T extends { content?: unknown[]; isError?: boolean }>(
    toolName: string,
    response: T
  ): T {
    // Repeat warning injection (applies to ALL tools, not just context-sensitive)
    if (this.isRepeatLoop() && !REPEAT_GUARD_EXCLUDES.has(toolName)) {
      this.injectRepeatWarning(toolName, response);
    }

    if (!this.isContextSensitive(toolName)) return response;
    if (response.isError) return response;

    const provider = this.getProvider();
    if (!provider) return response;

    const meta = provider.getContextMeta();
    // Skip if no active page tracked
    if (!meta.pageId && meta.tabIndex === null) return response;

    const content = response.content;
    if (!Array.isArray(content)) return response;

    const firstText = content.find(
      (c: unknown): c is { type: string; text: string } =>
        typeof c === 'object' &&
        c !== null &&
        (c as Record<string, unknown>).type === 'text' &&
        typeof (c as Record<string, unknown>).text === 'string'
    );
    if (!firstText) return response;

    const raw = firstText.text;
    const trimmedStart = raw.trimStart();

    // Fast path: JSON object text — splice _tabContext without full re-serialization
    if (trimmedStart.startsWith('{') && trimmedStart.trimEnd().endsWith('}')) {
      try {
        // Validate it's actually parseable JSON (cheap compared to re-stringify)
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Guard: skip if _tabContext was already injected (prevents double-injection)
          if ('_tabContext' in parsed) return response;
          firstText.text = this.spliceTabContext(raw, meta);
          return response;
        }
      } catch {
        logger.debug(`[ContextGuard] Skipped non-JSON response enrichment for ${toolName}`);
        return response;
      }
    }

    return response;
  }

  /**
   * Inject `_tabContext` into a JSON object string by splicing before the
   * closing brace, preserving the original formatting style (compact or pretty).
   */
  private spliceTabContext(
    raw: string,
    meta: {
      url: string | null;
      title: string | null;
      tabIndex: number | null;
      pageId: string | null;
    }
  ): string {
    const tabContext = {
      url: meta.url,
      title: meta.title,
      tabIndex: meta.tabIndex,
      pageId: meta.pageId,
    };

    // Detect pretty-print: if the closing brace is on its own line, match style
    if (/\n\}\s*$/.test(raw)) {
      const prettyJson = JSON.stringify(tabContext, null, 2).replace(/\n/g, '\n  ');
      return raw.replace(/\n\}\s*$/, `,\n  "_tabContext": ${prettyJson}\n}`);
    }

    // Compact style
    const compactJson = JSON.stringify(tabContext);
    if (/^\{\s*\}\s*$/.test(raw)) {
      return raw.replace(/\{\s*\}\s*$/, `{"_tabContext":${compactJson}}`);
    }
    return raw.replace(/\}\s*$/, `,"_tabContext":${compactJson}}`);
  }

  /**
   * Inject a `_repeatWarning` into the response when a tool call loop is detected.
   * Splices into JSON text content if possible, or appends a new text entry.
   */
  private injectRepeatWarning<T extends { content?: unknown[] }>(
    toolName: string,
    response: T
  ): void {
    const prefix = toolName.split('_')[0] ?? '';
    const alternatives = DOMAIN_ALTERNATIVES.get(prefix) ?? ['page_navigate', 'page_screenshot'];
    // Filter out the repeated tool itself from suggestions
    const suggestions = alternatives.filter((t) => t !== toolName);

    const warning = {
      detected: true,
      consecutiveCount: this.consecutiveCount,
      message:
        `⚠ You have called "${toolName}" ${this.consecutiveCount} times in a row. ` +
        `This is likely a loop — consider what you actually need to do next.`,
      suggestedTools: suggestions,
      hint: suggestions.length > 0
        ? `Try calling ${suggestions[0]} instead.`
        : 'Re-evaluate your task objective before making another tool call.',
    };

    const content = response.content;
    if (!Array.isArray(content)) return;

    const firstText = content.find(
      (c: unknown): c is { type: string; text: string } =>
        typeof c === 'object' &&
        c !== null &&
        (c as Record<string, unknown>).type === 'text' &&
        typeof (c as Record<string, unknown>).text === 'string'
    );

    if (firstText) {
      const raw = firstText.text;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          parsed._repeatWarning = warning;
          firstText.text = JSON.stringify(parsed, null, 2);
          return;
        }
      } catch {
        // Not JSON — fall through to append
      }
    }

    // Fallback: append as a new content item
    content.push({
      type: 'text',
      text: JSON.stringify({ _repeatWarning: warning }, null, 2),
    });
  }
}
