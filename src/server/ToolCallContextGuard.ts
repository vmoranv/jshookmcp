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
] as const;

export class ToolCallContextGuard {
  constructor(private getProvider: () => TabContextProvider | null) {}

  /** Check whether a tool name belongs to a context-sensitive domain. */
  isContextSensitive(toolName: string): boolean {
    return CONTEXT_SENSITIVE_PREFIXES.some((p) => toolName.startsWith(p));
  }

  /**
   * Enrich a successful tool response with `_tabContext` metadata.
   * Mutates the first text content item by parsing its JSON and appending the field.
   * If the content is not JSON, leaves it unchanged.
   *
   * Uses `<T>` passthrough so the returned type matches the input exactly.
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

    try {
      const parsed = JSON.parse(firstText.text);
      if (typeof parsed === 'object' && parsed !== null) {
        parsed._tabContext = {
          url: meta.url,
          title: meta.title,
          tabIndex: meta.tabIndex,
          pageId: meta.pageId,
        };
        firstText.text = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Not JSON — skip enrichment silently
      logger.debug(`[ContextGuard] Skipped non-JSON response enrichment for ${toolName}`);
    }

    return response;
  }
}
