import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersExtract } from '@server/domains/graphql/handlers.impl.core.runtime.extract';
import type { ExtractedGraphQLQuery } from '@server/domains/graphql/handlers.impl.core.runtime.shared';

function parseJson(response: any) {
  return JSON.parse(response.content[0]!.text);
}

describe('GraphQLToolHandlersExtract', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: GraphQLToolHandlersExtract;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersExtract(collector);
  });

  // ── successful extraction ───────────────────────────────────────────

  describe('successful extraction', () => {
    it('returns extracted queries with stats', async () => {
      const extraction = {
        scannedRecords: 10,
        totalExtracted: 2,
        extracted: [
          {
            source: 'window.__fetchRequests',
            url: 'https://api.example.com/graphql',
            method: 'POST',
            operationName: 'GetUser',
            query: 'query GetUser { user { name } }',
            variables: { id: '1' },
            timestamp: 1700000000000,
            contentType: 'application/json',
          },
          {
            source: 'window.__xhrRequests',
            url: 'https://api.example.com/graphql',
            method: 'POST',
            operationName: 'ListItems',
            query: 'query ListItems { items { id title } }',
            variables: null,
            timestamp: 1700000001000,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(10);
      expect(body.stats.totalExtracted).toBe(2);
      expect(body.stats.returned).toBe(2);
      expect(body.queries).toHaveLength(2);
    });

    it('includes query details in each result', async () => {
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'window.__fetchRequests',
            url: 'https://api.example.com/graphql',
            method: 'POST',
            operationName: 'GetUser',
            query: 'query GetUser { user { name } }',
            variables: { id: '1' },
            timestamp: 1700000000000,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      const q = body.queries[0];
      expect(q.index).toBe(0);
      expect(q.source).toBe('window.__fetchRequests');
      expect(q.url).toBe('https://api.example.com/graphql');
      expect(q.method).toBe('POST');
      expect(q.operationName).toBe('GetUser');
      expect(q.contentType).toBe('application/json');
      expect(q.timestamp).toBe(1700000000000);
      expect(q.query).toBe('query GetUser { user { name } }');
      expect(q.variables).toEqual({ id: '1' });
    });

    it('returns empty queries array when nothing extracted', async () => {
      const extraction = {
        scannedRecords: 5,
        totalExtracted: 0,
        extracted: [],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      expect(body.success).toBe(true);
      expect(body.queries).toHaveLength(0);
      expect(body.stats.returned).toBe(0);
    });
  });

  // ── limit argument ──────────────────────────────────────────────────

  describe('limit argument', () => {
    it('passes default limit of 50 to page.evaluate', async () => {
      const extraction = {
        scannedRecords: 0,
        totalExtracted: 0,
        extracted: [],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      await handlers.handleGraphqlExtractQueries({});

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 50);
    });

    it('passes custom limit to page.evaluate', async () => {
      const extraction = {
        scannedRecords: 0,
        totalExtracted: 0,
        extracted: [],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      await handlers.handleGraphqlExtractQueries({ limit: 10 });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 10);
    });

    it('clamps limit to max of 200', async () => {
      const extraction = {
        scannedRecords: 0,
        totalExtracted: 0,
        extracted: [],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      await handlers.handleGraphqlExtractQueries({ limit: 999 });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 200);
    });

    it('clamps limit to min of 1', async () => {
      const extraction = {
        scannedRecords: 0,
        totalExtracted: 0,
        extracted: [],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      await handlers.handleGraphqlExtractQueries({ limit: 0 });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 1);
    });

    it('includes limit in the response', async () => {
      const extraction = {
        scannedRecords: 0,
        totalExtracted: 0,
        extracted: [],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({ limit: 25 }));

      expect(body.limit).toBe(25);
    });
  });

  // ── query truncation ────────────────────────────────────────────────

  describe('query truncation', () => {
    it('includes full query when under the char limit', async () => {
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'test',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: null,
            query: 'query { ok }',
            variables: null,
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      const q = body.queries[0];
      expect(q.query).toBe('query { ok }');
      expect(q.queryTruncated).toBe(false);
    });

    it('truncates large queries', async () => {
      const largeQuery = 'query LargeQuery { ' + 'x'.repeat(20000) + ' }';
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'test',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: null,
            query: largeQuery,
            variables: null,
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      const q = body.queries[0];
      expect(q.queryTruncated).toBe(true);
      expect(q.query).toBeUndefined();
      expect(q.queryPreview).toBeDefined();
      expect(q.queryLength).toBe(largeQuery.length);
    });
  });

  // ── variables truncation ────────────────────────────────────────────

  describe('variables truncation', () => {
    it('includes variables when under the char limit', async () => {
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'test',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: null,
            query: 'query { ok }',
            variables: { id: '1' },
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      const q = body.queries[0];
      expect(q.variables).toEqual({ id: '1' });
      expect(q.variablesTruncated).toBeUndefined();
    });

    it('truncates large variables', async () => {
      const largeVars = { data: 'y'.repeat(10000) };
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'test',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: null,
            query: 'query { ok }',
            variables: largeVars,
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      const q = body.queries[0];
      expect(q.variablesTruncated).toBe(true);
      expect(q.variablesPreview).toBeDefined();
      expect(q.variables).toBeUndefined();
    });
  });

  // ── multiple queries ────────────────────────────────────────────────

  describe('multiple queries', () => {
    it('indexes queries sequentially', async () => {
      const extraction = {
        scannedRecords: 3,
        totalExtracted: 3,
        extracted: [
          {
            source: 'a',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: 'Op1',
            query: 'query Op1 { a }',
            variables: null,
            timestamp: null,
            contentType: 'application/json',
          },
          {
            source: 'b',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: 'Op2',
            query: 'query Op2 { b }',
            variables: null,
            timestamp: null,
            contentType: 'application/json',
          },
          {
            source: 'c',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: 'Op3',
            query: 'mutation Op3 { c }',
            variables: null,
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      expect(body.queries[0].index).toBe(0);
      expect(body.queries[1].index).toBe(1);
      expect(body.queries[2].index).toBe(2);
    });
  });

  // ── error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('catches and wraps unexpected errors', async () => {
      collector.getActivePage.mockRejectedValueOnce(new Error('Page gone'));

      const response = await handlers.handleGraphqlExtractQueries({});
      const body = parseJson(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toBe('Page gone');
    });

    it('catches page.evaluate errors', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('Evaluate timeout'));

      const response = await handlers.handleGraphqlExtractQueries({});
      const body = parseJson(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toBe('Evaluate timeout');
    });
  });

  // ── null variables handling ─────────────────────────────────────────

  describe('null variables', () => {
    it('handles null variables without crashing', async () => {
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'test',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: null,
            query: 'query { ok }',
            variables: null,
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));

      expect(body.success).toBe(true);
      expect(body.queries[0].variables).toBeNull();
    });
  });
});
