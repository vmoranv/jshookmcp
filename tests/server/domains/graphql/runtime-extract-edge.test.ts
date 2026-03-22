import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersExtract } from '@server/domains/graphql/handlers.impl.core.runtime.extract';
import type { ExtractedGraphQLQuery } from '@server/domains/graphql/handlers.impl.core.runtime.shared';



describe('GraphQLToolHandlersExtract - edge cases', () => {
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

  let handlers: GraphQLToolHandlersExtract;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersExtract(collector);
  });

  describe('mutation and subscription operation names', () => {
    it('detects mutation operation names in query text', async () => {
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'window.__fetchRequests',
            url: 'https://api.example.com/graphql',
            method: 'POST',
            operationName: 'UpdateUser',
            query: 'mutation UpdateUser($id: ID!) { updateUser(id: $id) { ok } }',
            variables: { id: '42' },
            timestamp: 1700000000000,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleGraphqlExtractQueries({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[0].operationName).toBe('UpdateUser');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[0].query).toContain('mutation');
    });

    it('handles subscription queries', async () => {
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'window.__xhrRequests',
            url: 'wss://api.example.com/graphql',
            method: 'POST',
            operationName: 'OnMessage',
            query: 'subscription OnMessage { messageAdded { id text } }',
            variables: null,
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleGraphqlExtractQueries({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[0].operationName).toBe('OnMessage');
    });
  });

  describe('null and missing fields', () => {
    it('handles null operationName with unnamed query', async () => {
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'test',
            url: 'https://example.com/graphql',
            method: 'POST',
            operationName: null,
            query: '{ viewer { id name } }',
            variables: null,
            timestamp: null,
            contentType: '',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleGraphqlExtractQueries({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[0].operationName).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[0].contentType).toBe('');
    });

    it('handles null timestamp in results', async () => {
      const extraction = {
        scannedRecords: 1,
        totalExtracted: 1,
        extracted: [
          {
            source: 'hook',
            url: 'https://api.test.com/graphql',
            method: 'POST',
            operationName: 'Q',
            query: 'query Q { q }',
            variables: null,
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleGraphqlExtractQueries({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[0].timestamp).toBeNull();
    });
  });

  describe('large payload handling', () => {
    it('handles many queries from extraction', async () => {
      const extracted: ExtractedGraphQLQuery[] = Array.from({ length: 100 }, (_, i) => ({
        source: `src_${i}`,
        url: `https://example.com/graphql`,
        method: 'POST',
        operationName: `Op${i}`,
        query: `query Op${i} { field${i} }`,
        variables: null,
        timestamp: Date.now() - i * 1000,
        contentType: 'application/json',
      }));

      page.evaluate.mockResolvedValueOnce({
        scannedRecords: 200,
        totalExtracted: 100,
        extracted,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleGraphqlExtractQueries({ limit: 50 }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.limit).toBe(50);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.totalExtracted).toBe(100);
    });
  });

  describe('query and variables truncation combined', () => {
    it('truncates both query and variables in same result', async () => {
      const largeQuery = 'query Big { ' + 'f'.repeat(20000) + ' }';
      const largeVars = { data: 'v'.repeat(10000) };
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
            variables: largeVars,
            timestamp: null,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleGraphqlExtractQueries({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const q = body.queries[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(q.queryTruncated).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(q.variablesTruncated).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(q.query).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(q.variables).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(q.queryPreview).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(q.variablesPreview).toBeDefined();
    });
  });

  describe('mixed sources', () => {
    it('preserves source information from different hook sources', async () => {
      const extraction = {
        scannedRecords: 3,
        totalExtracted: 3,
        extracted: [
          {
            source: 'window.__fetchRequests',
            url: 'https://api.test.com/graphql',
            method: 'POST',
            operationName: 'FetchOp',
            query: 'query FetchOp { a }',
            variables: null,
            timestamp: 3000,
            contentType: 'application/json',
          },
          {
            source: 'window.__xhrRequests',
            url: 'https://api.test.com/graphql',
            method: 'POST',
            operationName: 'XhrOp',
            query: 'query XhrOp { b }',
            variables: null,
            timestamp: 2000,
            contentType: 'application/json',
          },
          {
            source: 'window.__aiHooks.myHook',
            url: 'https://api.test.com/graphql',
            method: 'POST',
            operationName: 'HookOp',
            query: 'query HookOp { c }',
            variables: null,
            timestamp: 1000,
            contentType: 'application/json',
          },
        ] as ExtractedGraphQLQuery[],
      };
      page.evaluate.mockResolvedValueOnce(extraction);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleGraphqlExtractQueries({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries).toHaveLength(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[0].source).toBe('window.__fetchRequests');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[1].source).toBe('window.__xhrRequests');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.queries[2].source).toBe('window.__aiHooks.myHook');
    });
  });

  describe('edge case errors', () => {
    it('handles non-Error exceptions', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      collector.getActivePage.mockRejectedValueOnce('raw string error');

      const response = await handlers.handleGraphqlExtractQueries({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('raw string error');
    });

    it('handles page evaluate throwing an object', async () => {
      page.evaluate.mockRejectedValueOnce({ code: 'TIMEOUT', message: 'timed out' });

      const response = await handlers.handleGraphqlExtractQueries({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
    });
  });
});
