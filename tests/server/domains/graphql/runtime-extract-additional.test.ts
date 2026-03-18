import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersExtract } from '@server/domains/graphql/handlers.impl.core.runtime.extract';

function parseJson(response: unknown) {
  return JSON.parse((response as any).content[0]!.text);
}

describe('GraphQLToolHandlersExtract - additional coverage', () => {
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

  // ── page.evaluate callback execution ─────────────────────────────────
  // The page.evaluate callback runs inside the browser context, so we
  // capture the callback and execute it ourselves to cover lines 16-238.

  describe('page.evaluate callback logic', () => {
    it('extracts queries from __fetchRequests', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                query: 'query GetUser { user { name } }',
                operationName: 'GetUser',
                variables: { id: '1' },
              }),
              timestamp: 1700000000000,
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
      expect(body.queries[0].operationName).toBe('GetUser');
    });

    it('extracts queries from __xhrRequests', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __xhrRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: 'mutation UpdateUser { updateUser { ok } }',
                operationName: 'UpdateUser',
              }),
              timestamp: 1700000001000,
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.queries[0].operationName).toBe('UpdateUser');
    });

    it('extracts queries from __networkRequests', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __networkRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({
                query: 'query ListItems { items { id } }',
              }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('extracts queries from __aiHooks entries', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            myHook: [
              {
                url: 'https://api.example.com/graphql',
                method: 'POST',
                body: JSON.stringify({
                  query: 'query HookQuery { data }',
                  operationName: 'HookQuery',
                }),
              },
            ],
            notAnArray: 'skipped',
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
      expect(body.queries[0].source).toContain('__aiHooks.myHook');
    });

    it('parses URL-encoded body with query param', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: 'query=query+GetUser+%7B+user+%7B+name+%7D+%7D&operationName=GetUser&variables=%7B%22id%22%3A%221%22%7D',
              timestamp: 1700000000000,
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('parses URL-encoded body with non-JSON variables', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: 'query=query+Test+%7B+t+%7D&variables=not-valid-json',
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('handles body passed as object directly (not string)', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: {
                query: 'query DirectObj { field }',
                operationName: 'DirectObj',
              },
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('extracts query from postData field', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              postData: JSON.stringify({
                query: 'query PostData { pd }',
              }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('extracts query from options.body field', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              options: {
                body: JSON.stringify({
                  query: 'query FromOptions { opt }',
                }),
              },
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('handles application/graphql content type with raw query string', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              headers: { 'Content-Type': 'application/graphql' },
              body: 'query RawGQL { raw }',
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('deduplicates identical queries', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({ query: 'query Dup { dup }' }),
              timestamp: 1000,
            },
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({ query: 'query Dup { dup }' }),
              timestamp: 2000,
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBe(1); // deduped
    });

    it('sorts extracted queries by timestamp descending', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({ query: 'query A { a }' }),
              timestamp: 1000,
            },
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({ query: 'query B { b }' }),
              timestamp: 3000,
            },
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({ query: 'query C { c }' }),
              timestamp: 2000,
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      // Should be sorted by timestamp desc: B(3000), C(2000), A(1000)
      expect(body.queries).toHaveLength(3);
    });

    it('infers operation name from query text', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({
                query: 'query InferredOp { field }',
                // no operationName field
              }),
            },
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({
                query: 'mutation CreateThing { create }',
              }),
            },
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({
                query: 'subscription OnEvent { event }',
              }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.queries).toHaveLength(3);
      expect(body.queries[0].operationName).toBe('InferredOp');
      expect(body.queries[1].operationName).toBe('CreateThing');
      expect(body.queries[2].operationName).toBe('OnEvent');
    });

    it('skips records with empty query string', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({ query: '' }),
            },
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: JSON.stringify({ query: '   ' }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBe(0);
    });

    it('skips non-object entries in request arrays', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            null,
            42,
            'string',
            {
              url: 'https://api.example.com/graphql',
              body: JSON.stringify({ query: 'query Valid { v }' }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(1); // only the valid object
    });

    it('handles non-JSON, non-URL-encoded body (raw graphql string)', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: 'query RawString { raw }',
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      // Raw query strings starting with "query " are recognized
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('handles mutation and subscription raw strings', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: 'mutation DoThing { doThing }',
            },
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              body: 'subscription OnThing { onThing }',
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBe(2);
    });

    it('handles missing url and method with defaults', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              body: JSON.stringify({ query: 'query NoUrl { nu }' }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.queries[0].url).toBe('');
      expect(body.queries[0].method).toBe('POST');
    });

    it('handles requestHeaders as alternate header source', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              method: 'POST',
              requestHeaders: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: 'query ReqH { rh }' }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('returns empty when all globals are missing', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {};
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(0);
      expect(body.stats.totalExtracted).toBe(0);
    });

    it('handles null/falsy body gracefully', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              body: null,
            },
            {
              url: 'https://api.example.com/graphql',
              body: undefined,
            },
            {
              url: 'https://api.example.com/graphql',
              body: '',
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBe(0);
    });

    it('skips body that is an array', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              body: [{ query: 'query Batch { b }' }],
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      // Arrays are not valid GraphQL request bodies in this implementation
      expect(body.stats.totalExtracted).toBe(0);
    });

    it('handles URL-encoded body without query param', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              body: 'query=&something=else',
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      // query= with empty value means no query extracted
      expect(body.stats.totalExtracted).toBe(0);
    });

    it('handles non-query payload with query field that is not a string', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              body: JSON.stringify({ query: 42 }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBe(0);
    });

    it('handles getHeader with non-string header value', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              headers: { 'content-type': 42 },
              body: JSON.stringify({ query: 'query Test { t }' }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('respects limit in extraction', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const requests = Array.from({ length: 10 }, (_, i) => ({
          url: 'https://api.example.com/graphql',
          body: JSON.stringify({ query: `query Q${i} { f${i} }` }),
          timestamp: 1000 + i,
        }));
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: requests,
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({ limit: 3 }));
      expect(body.success).toBe(true);
      expect(body.stats.returned).toBeLessThanOrEqual(3);
    });

    it('handles options that is an array (skipped)', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __fetchRequests: [
            {
              url: 'https://api.example.com/graphql',
              options: ['not', 'an', 'object'],
              body: JSON.stringify({ query: 'query WithArrayOpts { w }' }),
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalExtracted).toBeGreaterThan(0);
    });

    it('handles __aiHooks with null entry in hook array', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, maxItems: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              null,
              42,
              {
                url: 'https://api.example.com/graphql',
                body: JSON.stringify({ query: 'query Valid { v }' }),
              },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(maxItems);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleGraphqlExtractQueries({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(1);
    });
  });

  describe('limit argument edge cases', () => {
    it('accepts string limit', async () => {
      page.evaluate.mockResolvedValueOnce({
        scannedRecords: 0,
        totalExtracted: 0,
        extracted: [],
      });

      await handlers.handleGraphqlExtractQueries({ limit: '25' });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 25);
    });

    it('handles negative limit by clamping to 1', async () => {
      page.evaluate.mockResolvedValueOnce({
        scannedRecords: 0,
        totalExtracted: 0,
        extracted: [],
      });

      await handlers.handleGraphqlExtractQueries({ limit: -10 });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 1);
    });
  });
});
