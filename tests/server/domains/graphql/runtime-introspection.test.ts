import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersIntrospection } from '@server/domains/graphql/handlers.impl.core.runtime.introspection';
import type { BrowserFetchResult } from '@server/domains/graphql/handlers.impl.core.runtime.shared';



describe('GraphQLToolHandlersIntrospection', () => {
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

  let handlers: GraphQLToolHandlersIntrospection;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersIntrospection(collector);
  });

  // ── argument validation ─────────────────────────────────────────────

  describe('argument validation', () => {
    it('returns error when endpoint is missing', async () => {
      const response = await handlers.handleGraphqlIntrospect({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Missing required argument: endpoint');
    });

    it('returns error when endpoint is empty string', async () => {
      const response = await handlers.handleGraphqlIntrospect({ endpoint: '  ' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Missing required argument: endpoint');
    });

    it('returns error when endpoint is not a string', async () => {
      const response = await handlers.handleGraphqlIntrospect({ endpoint: 42 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Missing required argument: endpoint');
    });
  });

  // ── endpoint validation ─────────────────────────────────────────────

  describe('endpoint validation', () => {
    it('returns error for invalid URL', async () => {
      const response = await handlers.handleGraphqlIntrospect({ endpoint: 'not-a-url' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Invalid endpoint URL');
    });

    it('returns error for SSRF target', async () => {
      isSsrfTargetMock.mockResolvedValueOnce(true);
      const response = await handlers.handleGraphqlIntrospect({
        endpoint: 'http://127.0.0.1/graphql',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Blocked');
    });

    it('returns error for unsupported protocol', async () => {
      const response = await handlers.handleGraphqlIntrospect({
        endpoint: 'ftp://example.com/graphql',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Unsupported endpoint protocol');
    });
  });

  // ── successful introspection ────────────────────────────────────────

  describe('successful introspection', () => {
    it('returns schema data from successful introspection', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{"data":{"__schema":{"types":[]}}}',
        responseJson: { data: { __schema: { types: [] } } },
        responseHeaders: { 'content-type': 'application/json' },
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const response = await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.endpoint).toBe('https://example.com/graphql');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.statusText).toBe('OK');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.schema).toEqual({ __schema: { types: [] } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.schemaTruncated).toBe(false);
    });

    it('extracts data field from response when present', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '',
        responseJson: { data: { __schema: { queryType: { name: 'Query' } } } },
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.schema).toEqual({ __schema: { queryType: { name: 'Query' } } });
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

      await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
        headers: { Authorization: 'Bearer token123' },
      });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          endpoint: 'https://example.com/graphql',
          headers: { Authorization: 'Bearer token123' },
          query: expect.stringContaining('IntrospectionQuery'),
        })
      );
    });

    it('includes response headers in output', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: { 'x-custom': 'value' },
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseHeaders).toEqual({ 'x-custom': 'value' });
    });
  });

  // ── failed introspection ────────────────────────────────────────────

  describe('failed introspection', () => {
    it('returns failure info when response is not ok and has no JSON', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        responseText: 'Server broke',
        responseJson: null,
        error: 'Server error',
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.status).toBe(500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('Server error');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responsePreview).toBeDefined();
    });

    it('uses default error when no error field and request failed', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 0,
        statusText: 'FETCH_ERROR',
        responseText: '',
        responseJson: null,
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('Introspection request failed');
    });

    it('includes GraphQL errors when present in response', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '',
        responseJson: {
          data: null,
          errors: [{ message: 'Not authorized' }],
        },
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.errors).toEqual([{ message: 'Not authorized' }]);
    });

    it('includes browser fetch error in response when present', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
        error: 'CORS issue',
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('CORS issue');
    });
  });

  // ── schema truncation ───────────────────────────────────────────────

  describe('schema truncation', () => {
    it('does not include schema field when truncated', async () => {
      const largeSchema = { data: { bigField: 'x'.repeat(200000) } };
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: JSON.stringify(largeSchema),
        responseJson: largeSchema,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.schemaTruncated).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.schema).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.schemaPreview).toBeDefined();
    });
  });

  // ── error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('catches and wraps unexpected errors', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      collector.getActivePage.mockRejectedValueOnce(new Error('No browser'));
      const response = await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('No browser');
    });

    it('handles non-object responseJson gracefully', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '"just a string"',
        responseJson: 'just a string',
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
    });

    it('uses responseText as fallback when responseJson is null but ok is true', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 200,
        statusText: 'OK',
        responseText: 'raw text data',
        responseJson: null,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responsePreview).toBeDefined();
    });
  });
});
