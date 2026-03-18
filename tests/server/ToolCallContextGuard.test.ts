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

function makeResponse(text: string, isError = false) {
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
    const parsed = JSON.parse((enriched.content[0] as any)!.text);

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
    const parsed = JSON.parse((enriched.content[0] as any)!.text);

    expect((enriched.content[0] as any)!.text).toContain('\n  "_tabContext":');
    expect(parsed._tabContext).toEqual(meta);
    expect(parsed.process.pid).toBe(1234);
  });

  it('skips enrichment for non-context-sensitive tools', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const response = makeResponse('{"success":true}');

    const enriched = guard.enrichResponse('activate_tools', response);

    expect((enriched.content[0] as any)!.text).toBe('{"success":true}');
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

    expect((guard.enrichResponse('page_evaluate', errorResponse).content[0] as any)!.text).toBe(
      '{"success":false}'
    );
    expect((guard.enrichResponse('page_evaluate', noPageResponse).content[0] as any)!.text).toBe(
      '{"success":true}'
    );
  });

  it('skips enrichment when there is no provider', () => {
    const guard = new ToolCallContextGuard(() => null);
    const response = makeResponse('{"success":true}');

    expect((guard.enrichResponse('page_evaluate', response).content[0] as any)!.text).toBe(
      '{"success":true}'
    );
  });

  it('skips enrichment when content is not a text array entry', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const nonArray = { isError: false, content: { type: 'text', text: '{}' } } as any;
    const nonText = {
      isError: false,
      content: [
        { type: 'image', url: 'https://vmoranv.github.io/jshookmcp/a.png' },
        { type: 'text', text: 123 },
      ],
    } as any;

    expect(guard.enrichResponse('page_evaluate', nonArray).content).toEqual(nonArray.content);
    expect(guard.enrichResponse('page_evaluate', nonText).content).toEqual(nonText.content);
  });

  it('injects tab context into the smallest JSON object payload', () => {
    const guard = new ToolCallContextGuard(() => ({
      getContextMeta: () => meta,
    }));
    const response = makeResponse('{}');

    const enriched = guard.enrichResponse('console_execute', response);
    const parsed = JSON.parse((enriched.content[0] as any)!.text);

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

    expect((guard.enrichResponse('console_execute', malformed).content[0] as any)!.text).toBe(
      '{not-valid-json}'
    );
    expect((guard.enrichResponse('console_execute', arrayPayload).content[0] as any)!.text).toBe(
      '[{"success":true}]'
    );
    expect((guard.enrichResponse('console_execute', plainText).content[0] as any)!.text).toBe(
      'not json at all'
    );
    expect((guard.enrichResponse('console_execute', stringPayload).content[0] as any)!.text).toBe(
      '"value"'
    );
  });
});
