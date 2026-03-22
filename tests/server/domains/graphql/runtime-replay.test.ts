import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersRuntime } from '@server/domains/graphql/handlers.impl.core.runtime.replay';
import type { BrowserFetchResult } from '@server/domains/graphql/handlers.impl.core.runtime.shared';



describe('GraphQLToolHandlersRuntime (replay)', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: GraphQLToolHandlersRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersRuntime(collector);
  });

  // ── argument validation ─────────────────────────────────────────────

  describe('argument validation', () => {
    it('returns error when endpoint is missing', async () => {
      const response = await handlers.handleGraphqlReplay({
        query: 'query { ok }',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Missing required argument: endpoint');
    });

    it('returns error when endpoint is empty after trim', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: '   ',
        query: 'query { ok }',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Missing required argument: endpoint');
    });

    it('returns error when query is missing', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Missing required argument: query');
    });

    it('returns error when query is empty string', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: '   ',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Missing required argument: query');
    });

    it('returns error when query is not a string', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 42,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Missing required argument: query');
    });
  });

  // ── endpoint validation ─────────────────────────────────────────────

  describe('endpoint validation', () => {
    it('returns error for invalid URL', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: 'not-valid',
        query: 'query { ok }',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Invalid endpoint URL');
    });

    it('returns error for SSRF target', async () => {
      isSsrfTargetMock.mockResolvedValueOnce(true);
      const response = await handlers.handleGraphqlReplay({
        endpoint: 'http://169.254.169.254/graphql',
        query: 'query { ok }',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Blocked');
    });
  });

  // ── successful replay with JSON response ────────────────────────────

  describe('successful replay with JSON response', () => {
    it('returns parsed JSON response data', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{"data":{"user":{"name":"Alice"}}}',
        responseJson: { data: { user: { name: 'Alice' } } },
        responseHeaders: { 'content-type': 'application/json' },
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query GetUser { user { name } }',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.statusText).toBe('OK');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.response).toEqual({ data: { user: { name: 'Alice' } } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseTruncated).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseHeaders).toEqual({ 'content-type': 'application/json' });
    });

    it('passes variables to page.evaluate', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
        variables: { id: '123' },
      });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          variables: { id: '123' },
        })
      );
    });

    it('defaults variables to empty object when not provided', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 'query { ok }',
      });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          variables: {},
        })
      );
    });

    it('passes operationName when provided', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query GetUser { user { name } }',
          operationName: 'GetUser',
        })
      );

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          operationName: 'GetUser',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.operationName).toBe('GetUser');
    });

    it('sets operationName to null when empty string', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query { ok }',
          operationName: '   ',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.operationName).toBeNull();
    });

    it('passes custom headers to page.evaluate', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 'query { ok }',
        headers: { Authorization: 'Bearer xyz' },
      });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          headers: { Authorization: 'Bearer xyz' },
        })
      );
    });
  });

  // ── response with text fallback ─────────────────────────────────────

  describe('text response fallback', () => {
    it('uses text preview when responseJson is null', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: 'This is plain text, not JSON',
        responseJson: null,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query { ok }',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseFormat).toBe('text');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responsePreview).toBe('This is plain text, not JSON');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.response).toBeUndefined();
    });
  });

  // ── response truncation ─────────────────────────────────────────────

  describe('response truncation', () => {
    it('truncates large JSON responses', async () => {
      const largeData = { data: 'x'.repeat(200000) };
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: JSON.stringify(largeData),
        responseJson: largeData,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query { ok }',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseTruncated).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.response).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responsePreview).toBeDefined();
    });

    it('truncates large text responses', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 200,
        statusText: 'OK',
        responseText: 'y'.repeat(200000),
        responseJson: null,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query { ok }',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseTruncated).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseFormat).toBe('text');
    });
  });

  // ── error in response ───────────────────────────────────────────────

  describe('error handling', () => {
    it('includes error field from browser result', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 0,
        statusText: 'FETCH_ERROR',
        responseText: '',
        responseJson: null,
        error: 'Network request failed',
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query { ok }',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('Network request failed');
    });

    it('catches unexpected exceptions', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      collector.getActivePage.mockRejectedValueOnce(new Error('Browser disconnected'));

      const response = await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 'query { ok }',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('Browser disconnected');
    });

    it('handles empty responseHeaders gracefully', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query { ok }',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseHeaders).toEqual({});
    });
  });

  // ── response metadata ───────────────────────────────────────────────

  describe('response metadata', () => {
    it('includes endpoint and status in response', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query { ok }',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.endpoint).toBe('https://example.com/graphql');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.statusText).toBe('OK');
    });

    it('includes responseLength for JSON', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{"data":true}',
        responseJson: { data: true },
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: 'https://example.com/graphql',
          query: 'query { ok }',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(typeof body.responseLength).toBe('number');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseLength).toBeGreaterThan(0);
    });
  });
});
