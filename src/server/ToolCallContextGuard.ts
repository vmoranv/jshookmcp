/**
 * ToolCallContextGuard — enriches tool responses with current tab context.
 *
 * For context-sensitive tools (page_*, console_*, debugger_*, network_*, dom_*, etc.),
 * appends `_tabContext` metadata to responses so the LLM always knows which page
 * it is operating on, preventing silent context drift.
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

export class ToolCallContextGuard {
  /** Memoize prefix-match results — tool names repeat heavily across calls. */
  private readonly contextSensitiveCache = new Map<string, boolean>();

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
}
