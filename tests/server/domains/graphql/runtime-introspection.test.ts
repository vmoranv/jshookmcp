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
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Missing required argument: endpoint');
    });

    it('returns error when endpoint is empty string', async () => {
      const response = await handlers.handleGraphqlIntrospect({ endpoint: '  ' });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Missing required argument: endpoint');
    });

    it('returns error when endpoint is not a string', async () => {
      const response = await handlers.handleGraphqlIntrospect({ endpoint: 42 });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Missing required argument: endpoint');
    });
  });

  // ── endpoint validation ─────────────────────────────────────────────

  describe('endpoint validation', () => {
    it('returns error for invalid URL', async () => {
      const response = await handlers.handleGraphqlIntrospect({ endpoint: 'not-a-url' });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Invalid endpoint URL');
    });

    it('returns error for SSRF target', async () => {
      isSsrfTargetMock.mockResolvedValueOnce(true);
      const response = await handlers.handleGraphqlIntrospect({
        endpoint: 'http://127.0.0.1/graphql',
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Blocked');
    });

    it('returns error for unsupported protocol', async () => {
      const response = await handlers.handleGraphqlIntrospect({
        endpoint: 'ftp://example.com/graphql',
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Unsupported endpoint protocol');
    });
  });

  // ── successful introspection ────────────────────────────────────────

  describe('successful introspection', () => {
    it('returns schema data from successful introspection', async () => {
      const schemaData = { __schema: { types: [] } };
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: 50,
        preview: JSON.stringify({ data: schemaData }),
        truncated: false,
        json: { data: schemaData },
        responseHeaders: { 'content-type': 'application/json' },
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const response = await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
      });
      const body = parseJson<any>(response);

      expect((response as any).isError).toBeUndefined();
      expect(body.success).toBe(true);
      expect(body.endpoint).toBe('https://example.com/graphql');
      expect(body.status).toBe(200);
      expect(body.statusText).toBe('OK');
      expect(body.schema).toEqual({ __schema: { types: [] } });
      expect(body.schemaTruncated).toBe(false);
    });

    it('extracts data field from response when present', async () => {
      const schemaData = { __schema: { queryType: { name: 'Query' } } };
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: 60,
        preview: JSON.stringify({ data: schemaData }),
        truncated: false,
        json: { data: schemaData },
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );
      expect(body.schema).toEqual({ __schema: { queryType: { name: 'Query' } } });
    });

    it('passes custom headers to page.evaluate', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: 2,
        preview: '{}',
        truncated: false,
        json: {},
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
        }),
      );
    });

    it('includes response headers in output', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: 2,
        preview: '{}',
        truncated: false,
        json: {},
        responseHeaders: { 'x-custom': 'value' },
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );
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
        totalLength: 12,
        preview: 'Server broke',
        truncated: false,
        json: null,
        error: 'Server error',
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );

      expect(body.success).toBe(false);
      expect(body.status).toBe(500);
      expect(body.error).toBe('Server error');
      expect(body.responsePreview).toBeDefined();
    });

    it('uses default error when no error field and request failed', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 0,
        statusText: 'FETCH_ERROR',
        totalLength: 0,
        preview: '',
        truncated: false,
        json: null,
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );
      expect(body.error).toBe('Introspection request failed');
    });

    it('includes GraphQL errors when present in response', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: 60,
        preview: JSON.stringify({ data: null, errors: [{ message: 'Not authorized' }] }),
        truncated: false,
        json: {
          data: null,
          errors: [{ message: 'Not authorized' }],
        },
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );
      expect(body.errors).toEqual([{ message: 'Not authorized' }]);
    });

    it('includes browser fetch error in response when present', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: 2,
        preview: '{}',
        truncated: false,
        json: {},
        responseHeaders: {},
        error: 'CORS issue',
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );
      expect(body.error).toBe('CORS issue');
    });
  });

  // ── schema truncation ───────────────────────────────────────────────

  describe('schema truncation', () => {
    it('does not include schema field when truncated', async () => {
      const largeSchema = { data: { bigField: 'x'.repeat(200000) } };
      const largeText = JSON.stringify(largeSchema);
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: largeText.length,
        preview: largeText.slice(0, 100000) + '\n... (truncated)',
        truncated: true,
        json: largeSchema,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );
      expect(body.schemaTruncated).toBe(true);
      expect(body.schema).toBeUndefined();
      expect(body.schemaPreview).toBeDefined();
    });

    it('keeps schema when only non-schema fields make the raw body exceed the limit', async () => {
      const schemaData = { __schema: { queryType: { name: 'Query' } } };
      const rawPayload = {
        data: schemaData,
        extensions: { trace: 'x'.repeat(200000) },
      };
      const rawText = JSON.stringify(rawPayload);
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: rawText.length,
        preview: rawText.slice(0, 100000) + '\n... (truncated)',
        truncated: true,
        json: rawPayload,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );

      expect(body.schemaTruncated).toBe(false);
      expect(body.schema).toEqual(schemaData);
      expect(body.schemaLength).toBe(JSON.stringify(schemaData, null, 2).length);
      expect(body.schemaPreview).toBe(JSON.stringify(schemaData, null, 2));
    });
  });

  // ── error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('catches and wraps unexpected errors', async () => {
      collector.getActivePage.mockRejectedValueOnce(new Error('No browser'));
      const response = await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toBe('No browser');
    });

    it('handles non-object responseJson gracefully', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        totalLength: 16,
        preview: '"just a string"',
        truncated: false,
        json: 'just a string',
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );
      expect(body.success).toBe(true);
    });

    it('uses responseText as fallback when responseJson is null but ok is true', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 200,
        statusText: 'OK',
        totalLength: 13,
        preview: 'raw text data',
        truncated: false,
        json: null,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlIntrospect({
          endpoint: 'https://example.com/graphql',
        }),
      );
      expect(body.responsePreview).toBeDefined();
    });
  });
});
