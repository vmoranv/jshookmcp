import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ToolCallContextGuard } from '@server/ToolCallContextGuard';

interface TextContent {
  type: 'text';
  text: string;
}

interface McpResponse {
  content: (TextContent | { type: string; [key: string]: unknown })[];
  isError?: boolean;
}

function getText(response: McpResponse, index = 0): string {
  const item = response.content[index];
  if (item && 'text' in item && typeof item.text === 'string') {
    return item.text;
  }
  throw new Error(`Content item at index ${index} is not a text content`);
}

function makeResponse(text: string, isError = false): McpResponse {
  return {
    isError,
    content: [{ type: 'text', text }],
  };
}

describe('ToolCallContextGuard', () => {
  const meta = {
    url: 'https://vmoranv.github.io/jshookmcp/app',
    title: 'Example App',
    tabIndex: 2,
    pageId: 'page-2',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects tab context into compact JSON responses for context-sensitive tools', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const response = makeResponse('{"success":true}');

    const enriched = guard.enrichResponse('page_navigate', response);
    const parsed = JSON.parse(getText(enriched));

    expect(parsed).toMatchObject({
      success: true,
      _tabContext: meta,
    });
  });

  it('injects tab context into pretty JSON responses without breaking parsing', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const response = makeResponse(
      JSON.stringify(
        {
          success: true,
          process: { pid: 1234 },
        },
        null,
        2
      )
    );

    const enriched = guard.enrichResponse('network_get_requests', response);
    const parsed = JSON.parse(getText(enriched));

    expect(getText(enriched)).toContain('\n  "_tabContext":');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed._tabContext).toEqual(meta);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.process.pid).toBe(1234);
  });

  it('skips enrichment for non-context-sensitive tools', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const response = makeResponse('{"success":true}');

    const enriched = guard.enrichResponse('activate_tools', response);

    expect(getText(enriched)).toBe('{"success":true}');
  });

  it('skips enrichment when the response is an error or there is no active page context', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => ({
        url: null,
        title: null,
        tabIndex: null,
        pageId: null,
      }),
    }));
    const errorResponse = makeResponse('{"success":false}', true);
    const noPageResponse = makeResponse('{"success":true}');

    expect(getText(guard.enrichResponse('page_evaluate', errorResponse))).toBe(
      '{"success":false}'
    );
    expect(getText(guard.enrichResponse('page_evaluate', noPageResponse))).toBe(
      '{"success":true}'
    );
  });

  it('skips enrichment when there is no provider', () => {
    const guard = new ToolCallContextGuard(() => null);
    const response = makeResponse('{"success":true}');

    expect(getText(guard.enrichResponse('page_evaluate', response))).toBe(
      '{"success":true}'
    );
  });

  it('skips enrichment when content is not a text array entry', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const nonArray = { isError: false, content: { type: 'text', text: '{}' } } as unknown as McpResponse;
    const nonText = {
      isError: false,
      content: [
        { type: 'image', url: 'https://vmoranv.github.io/jshookmcp/a.png' },
        { type: 'text', text: 123 },
      ],
    } as unknown as McpResponse;

    expect(guard.enrichResponse('page_evaluate', nonArray).content).toEqual(nonArray.content);
    expect(guard.enrichResponse('page_evaluate', nonText).content).toEqual(nonText.content);
  });

  it('injects tab context into the smallest JSON object payload', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const response = makeResponse('{}');

    const enriched = guard.enrichResponse('console_execute', response);
    const parsed = JSON.parse(getText(enriched));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed._tabContext).toEqual(meta);
  });

  it('leaves malformed or non-object JSON payloads unchanged', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const malformed = makeResponse('{not-valid-json}');
    const arrayPayload = makeResponse('[{"success":true}]');
    const plainText = makeResponse('not json at all');
    const stringPayload = makeResponse('"value"');

    expect(getText(guard.enrichResponse('console_execute', malformed))).toBe(
      '{not-valid-json}'
    );
    expect(getText(guard.enrichResponse('console_execute', arrayPayload))).toBe(
      '[{"success":true}]'
    );
    expect(getText(guard.enrichResponse('console_execute', plainText))).toBe(
      'not json at all'
    );
    expect(getText(guard.enrichResponse('console_execute', stringPayload))).toBe(
      '"value"'
    );
  });

  // ── Edge case tests (P2-2) ──

  it('does not double-inject _tabContext if it already exists', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const alreadyEnriched = makeResponse(
      `{"success":true,"_tabContext":{"url":"https://old.example.com","title":"Old","tabIndex":0,"pageId":"p-0"}}`
    );

    const result = guard.enrichResponse('page_navigate', alreadyEnriched);
    const parsed = JSON.parse(getText(result));

    // Should preserve the original _tabContext, not inject a new one
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed._tabContext.url).toBe('https://old.example.com');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed._tabContext.pageId).toBe('p-0');
  });

  it('handles JSON values containing newline-closing-brace patterns in strings', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    // The string value itself contains \n} which could confuse the regex splice
    const tricky = makeResponse(JSON.stringify({ code: 'function() {\n  return 1;\n}', ok: true }));

    const enriched = guard.enrichResponse('page_evaluate', tricky);
    const parsed = JSON.parse(getText(enriched));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.code).toBe('function() {\n  return 1;\n}');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.ok).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed._tabContext).toEqual(meta);
  });

  it('handles JSON with leading and trailing whitespace around braces', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const padded = makeResponse('  { "key": "value" }  ');

    const enriched = guard.enrichResponse('dom_get_structure', padded);
    const parsed = JSON.parse(getText(enriched));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.key).toBe('value');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed._tabContext).toEqual(meta);
  });

  it('skips enrichment when content array is empty', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const emptyContent = { isError: false, content: [] as any[] };

    const result = guard.enrichResponse('page_navigate', emptyContent);
    expect(result.content).toEqual([]);
  });

  it('only enriches the first text entry when multiple text items exist', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const multiText = {
      isError: false,
      content: [
        { type: 'text', text: '{"first":true}' },
        { type: 'text', text: '{"second":true}' },
      ],
    };

    const result = guard.enrichResponse('network_get_requests', multiText);
    const first = JSON.parse(getText(result));
    const second = getText(result, 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(first._tabContext).toEqual(meta);
    expect(second).toBe('{"second":true}'); // untouched
  });

  it('handles JSON with Unicode and special characters correctly', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const unicode = makeResponse(JSON.stringify({ msg: '你好世界 🌍', emoji: '✅', path: 'C:\\Users\\test' }));

    const enriched = guard.enrichResponse('console_execute', unicode);
    const parsed = JSON.parse(getText(enriched));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.msg).toBe('你好世界 🌍');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.emoji).toBe('✅');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.path).toBe('C:\\Users\\test');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed._tabContext).toEqual(meta);
  });

  it('caches isContextSensitive results and returns consistent values', () => {
    const guard = new ToolCallContextGuard(() => null);

    // First call computes, second uses cache
    expect(guard.isContextSensitive('page_navigate')).toBe(true);
    expect(guard.isContextSensitive('page_navigate')).toBe(true);
    expect(guard.isContextSensitive('activate_tools')).toBe(false);
    expect(guard.isContextSensitive('activate_tools')).toBe(false);

    // All domain prefixes
    expect(guard.isContextSensitive('console_execute')).toBe(true);
    expect(guard.isContextSensitive('debugger_enable')).toBe(true);
    expect(guard.isContextSensitive('network_enable')).toBe(true);
    expect(guard.isContextSensitive('dom_get_structure')).toBe(true);
    expect(guard.isContextSensitive('stealth_check')).toBe(true);
    expect(guard.isContextSensitive('framework_detect')).toBe(true);
    expect(guard.isContextSensitive('indexeddb_list')).toBe(true);
    expect(guard.isContextSensitive('js_heap_snapshot')).toBe(true);
    expect(guard.isContextSensitive('script_list')).toBe(true);
    expect(guard.isContextSensitive('captcha_solve')).toBe(true);

    // Non-matching
    expect(guard.isContextSensitive('search_tools')).toBe(false);
    expect(guard.isContextSensitive('browser_launch')).toBe(false);
  });

  // ── Repeat call guard tests ──

  describe('repeat call guard', () => {
    it('injects _repeatWarning after 3 consecutive identical calls', () => {
      const guard = new ToolCallContextGuard(() => ({
        getContextMeta: () => meta,
      }));

      guard.recordCall('stealth_inject');
      guard.recordCall('stealth_inject');
      guard.recordCall('stealth_inject');

      expect(guard.isRepeatLoop()).toBe(true);

      const response = makeResponse('{"success":true}');
      const enriched = guard.enrichResponse('stealth_inject', response);
      const parsed = JSON.parse(getText(enriched));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning.detected).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning.consecutiveCount).toBe(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning.suggestedTools).toContain('page_navigate');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning.suggestedTools).not.toContain('stealth_inject');
    });

    it('resets repeat counter when a different tool is called', () => {
      const guard = new ToolCallContextGuard(() => ({
        getContextMeta: () => meta,
      }));

      guard.recordCall('stealth_inject');
      guard.recordCall('stealth_inject');
      guard.recordCall('page_navigate'); // reset
      guard.recordCall('stealth_inject');
      guard.recordCall('stealth_inject');

      expect(guard.isRepeatLoop()).toBe(false);

      const response = makeResponse('{"success":true}');
      const enriched = guard.enrichResponse('stealth_inject', response);
      const parsed = JSON.parse(getText(enriched));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning).toBeUndefined();
    });

    it('does not warn for meta-tools even after many repeats', () => {
      const guard = new ToolCallContextGuard(() => null);

      for (let i = 0; i < 10; i++) {
        guard.recordCall('search_tools');
      }

      expect(guard.isRepeatLoop()).toBe(false);

      const response = makeResponse('{"results":[]}');
      const enriched = guard.enrichResponse('search_tools', response);
      const parsed = JSON.parse(getText(enriched));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning).toBeUndefined();
    });

    it('does not inject warning for fewer than 3 repeats', () => {
      const guard = new ToolCallContextGuard(() => ({
        getContextMeta: () => meta,
      }));

      guard.recordCall('stealth_inject');
      guard.recordCall('stealth_inject');

      expect(guard.isRepeatLoop()).toBe(false);

      const response = makeResponse('{"success":true}');
      const enriched = guard.enrichResponse('stealth_inject', response);
      const parsed = JSON.parse(getText(enriched));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning).toBeUndefined();
    });

    it('preserves _tabContext alongside _repeatWarning', () => {
      const guard = new ToolCallContextGuard(() => ({
        getContextMeta: () => meta,
      }));

      guard.recordCall('stealth_inject');
      guard.recordCall('stealth_inject');
      guard.recordCall('stealth_inject');

      const response = makeResponse('{"success":true}');
      const enriched = guard.enrichResponse('stealth_inject', response);
      const parsed = JSON.parse(getText(enriched));

      // Both should be present
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._tabContext).toEqual(meta);
    });

    it('appends warning as new content item for non-JSON responses', () => {
      const guard = new ToolCallContextGuard(() => null);

      guard.recordCall('browser_launch');
      guard.recordCall('browser_launch');
      guard.recordCall('browser_launch');

      const response = { content: [{ type: 'text', text: 'plain text response' }] };
      const enriched = guard.enrichResponse('browser_launch', response);

      // Non-context-sensitive, so no _tabContext, but repeat warning should be appended
      expect(enriched.content.length).toBe(2);
      const warningItem = JSON.parse(getText(enriched, 1));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(warningItem._repeatWarning.detected).toBe(true);
    });

    it('uses domain-specific alternatives for known prefixes', () => {
      const guard = new ToolCallContextGuard(() => ({
        getContextMeta: () => meta,
      }));

      guard.recordCall('page_navigate');
      guard.recordCall('page_navigate');
      guard.recordCall('page_navigate');

      const response = makeResponse('{"success":true}');
      const enriched = guard.enrichResponse('page_navigate', response);
      const parsed = JSON.parse(getText(enriched));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning.suggestedTools).toContain('dom_get_structure');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed._repeatWarning.suggestedTools).not.toContain('page_navigate');
    });

    it('recordCall returns correct consecutive count', () => {
      const guard = new ToolCallContextGuard(() => null);

      expect(guard.recordCall('stealth_inject')).toBe(1);
      expect(guard.recordCall('stealth_inject')).toBe(2);
      expect(guard.recordCall('stealth_inject')).toBe(3);
      expect(guard.recordCall('page_navigate')).toBe(1);
      expect(guard.recordCall('page_navigate')).toBe(2);
    });

    it('recordCall returns 0 for meta-tools', () => {
      const guard = new ToolCallContextGuard(() => null);

      expect(guard.recordCall('search_tools')).toBe(0);
      expect(guard.recordCall('route_tool')).toBe(0);
      expect(guard.recordCall('call_tool')).toBe(0);
    });
  });
});
