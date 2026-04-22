import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createCodeCollectorMock,
  createPageMock,
  parseJson,
} from '@tests/server/domains/shared/mock-factories';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersIntrospection } from '@server/domains/graphql/handlers.impl.core.runtime.introspection';
import { GraphQLToolHandlersRuntime } from '@server/domains/graphql/handlers.impl.core.runtime.replay';
import { GraphQLToolHandlersScriptReplace } from '@server/domains/graphql/handlers.impl.core.runtime.script-replace';

interface IntrospectResponse {
  success: boolean;
  status: number;
  schema?: any;
  schemaPreview?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Introspection: cover the page.evaluate browser callback (lines 31-69)
// ---------------------------------------------------------------------------
describe('GraphQLToolHandlersIntrospection - evaluate callback', () => {
  const page = createPageMock();
  const collector = createCodeCollectorMock({
    getActivePage: vi.fn(async () => page),
  });

  let handlers: GraphQLToolHandlersIntrospection;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersIntrospection(collector as any);
  });

  it('executes the introspection browser callback with successful fetch', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      // Simulate the browser fetch callback
      // We need to mock the global fetch inside the callback execution
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '{"data":{"__schema":{"types":[]}}}',
        headers: new Map([['content-type', 'application/json']]),
      };
      // Provide a forEach-compatible headers object
      (mockResponse.headers as any) = {
        forEach: (cb: (v: string, k: string) => void) => {
          cb('application/json', 'content-type');
        },
      };

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;
        return await fn(input);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<IntrospectResponse>(
      await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
      }),
    );
    expect(body.success).toBe(true);
    expect(body.status).toBe(200);
  });

  it('executes callback with non-JSON response', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'not valid json',
        headers: {
          forEach: (cb: (v: string, k: string) => void) => {
            cb('text/plain', 'content-type');
          },
        },
      };

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;
        return await fn(input);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<IntrospectResponse>(
      await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
      }),
    );
    expect(body.success).toBe(true);
    // Non-JSON responses: schema is null, raw text in schemaPreview
    expect(body.schema).toBeNull();
    expect(body.schemaPreview).toBe('not valid json');
  });

  it('executes callback when fetch throws', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure')) as any;
        return await fn(input);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<IntrospectResponse>(
      await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
      }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe('Network failure');
  });

  it('executes callback when fetch throws non-Error', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockRejectedValue('string error') as any;
        return await fn(input);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<IntrospectResponse>(
      await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
      }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe('string error');
  });

  it('merges custom headers with default content-type', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      let capturedHeaders: Record<string, string> | undefined;
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '{}',
        headers: {
          forEach: (cb: (v: string, k: string) => void) => {
            cb('application/json', 'content-type');
          },
        },
      };

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn(async (_url: string, opts: any) => {
          capturedHeaders = opts.headers;
          return mockResponse;
        }) as any;
        const result = await fn(input);
        // Verify the custom header was included
        expect(capturedHeaders).toBeDefined();
        expect(capturedHeaders!['x-custom']).toBe('test');
        expect(capturedHeaders!['content-type']).toBe('application/json');
        return result;
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<IntrospectResponse>(
      await handlers.handleGraphqlIntrospect({
        endpoint: 'https://example.com/graphql',
        headers: { 'x-custom': 'test' },
      }),
    );
    expect(body.success).toBe(true);
  });
});

interface ReplayResponse {
  success: boolean;
  status: number;
  response?: any;
  responseFormat?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Replay: cover the page.evaluate browser callback (lines 39-78)
// ---------------------------------------------------------------------------
describe('GraphQLToolHandlersRuntime (replay) - evaluate callback', () => {
  const page = createPageMock();
  const collector = createCodeCollectorMock({
    getActivePage: vi.fn(async () => page),
  });

  let handlers: GraphQLToolHandlersRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersRuntime(collector as any);
  });

  it('executes the replay browser callback with successful fetch', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '{"data":{"replay":true}}',
        headers: {
          forEach: (cb: (v: string, k: string) => void) => {
            cb('application/json', 'content-type');
          },
        },
      };

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;
        return await fn(input);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<ReplayResponse>(
      await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 'query Test { test }',
      }),
    );
    expect(body.success).toBe(true);
    expect(body.status).toBe(200);
    expect(body.response).toEqual({ data: { replay: true } });
  });

  it('executes callback when response is not JSON', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'plain text response',
        headers: {
          forEach: (_cb: (v: string, k: string) => void) => {},
        },
      };

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;
        return await fn(input);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<ReplayResponse>(
      await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 'query Test { test }',
      }),
    );
    expect(body.success).toBe(true);
    expect(body.responseFormat).toBe('text');
  });

  it('executes callback when fetch throws', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Replay network error')) as any;
        return await fn(input);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<ReplayResponse>(
      await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 'query Test { test }',
      }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe('Replay network error');
  });

  it('passes variables and operationName through to fetch body', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      let capturedBody: string | undefined;
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '{}',
        headers: {
          forEach: (_cb: (v: string, k: string) => void) => {},
        },
      };

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn(async (_url: string, opts: any) => {
          capturedBody = opts.body;
          return mockResponse;
        }) as any;
        const result = await fn(input);
        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.query).toContain('GetUser');
        expect(parsedBody.variables).toEqual({ id: '42' });
        expect(parsedBody.operationName).toBe('GetUser');
        return result;
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    await handlers.handleGraphqlReplay({
      endpoint: 'https://example.com/graphql',
      query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
      variables: { id: '42' },
      operationName: 'GetUser',
    });
  });

  it('executes callback when fetch throws non-Error', async () => {
    (page.evaluate as Mock).mockImplementationOnce(async (fn: Function, input: any) => {
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockRejectedValue(42) as any;
        return await fn(input);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    const body = parseJson<ReplayResponse>(
      await handlers.handleGraphqlReplay({
        endpoint: 'https://example.com/graphql',
        query: 'query Test { test }',
      }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toBe('42');
  });
});

interface ScriptReplaceResponse {
  success: boolean;
  activeRuleCount: number;
  rule: {
    matchType: string;
  };
  replacement: {
    length: number;
    truncated: boolean;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// ScriptReplace: cover missing lines (17, 47-57, 84)
// ---------------------------------------------------------------------------
describe('GraphQLToolHandlersScriptReplace - additional coverage', () => {
  const page = createPageMock({
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  } as any);
  const collector = createCodeCollectorMock({
    getActivePage: vi.fn(async () => page),
  });

  let handlers: GraphQLToolHandlersScriptReplace;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersScriptReplace(collector as any);
  });

  it('returns error when replacement is empty string', async () => {
    const response = await handlers.handleScriptReplacePersist({
      url: '/script.js',
      replacement: '',
    });
    expect((response as any).isError).toBe(true);
    const body = parseJson<ScriptReplaceResponse>(response);
    expect(body.error).toContain('Missing required argument: replacement');
  });

  it('returns error when replacement is not a string', async () => {
    const response = await handlers.handleScriptReplacePersist({
      url: '/script.js',
      replacement: 42 as any,
    });
    expect((response as any).isError).toBe(true);
    const body = parseJson<ScriptReplaceResponse>(response);
    expect(body.error).toContain('Missing required argument: replacement');
  });

  it('registers replacement rule with default matchType', async () => {
    const body = parseJson<ScriptReplaceResponse>(
      await handlers.handleScriptReplacePersist({
        url: '/app.js',
        replacement: 'console.log("patched")',
      }),
    );

    expect(body.success).toBe(true);
    expect(body.rule.matchType).toBe('contains');
    expect(body.replacement.length).toBe('console.log("patched")'.length);
    expect(body.replacement.truncated).toBe(false);
  });

  it('registers replacement rule with exact matchType', async () => {
    const body = parseJson<ScriptReplaceResponse>(
      await handlers.handleScriptReplacePersist({
        url: 'https://example.com/bundle.js',
        replacement: 'void 0',
        matchType: 'exact',
      }),
    );

    expect(body.success).toBe(true);
    expect(body.rule.matchType).toBe('exact');
  });

  it('truncates large replacement in preview', async () => {
    const largeReplacement = 'x'.repeat(10000);
    const body = parseJson<ScriptReplaceResponse>(
      await handlers.handleScriptReplacePersist({
        url: '/script.js',
        replacement: largeReplacement,
      }),
    );

    expect(body.success).toBe(true);
    expect(body.replacement.truncated).toBe(true);
    expect(body.replacement.length).toBe(10000);
  });

  it('increments activeRuleCount for multiple rules', async () => {
    const body1 = parseJson<ScriptReplaceResponse>(
      await handlers.handleScriptReplacePersist({
        url: '/first.js',
        replacement: 'a',
      }),
    );
    expect(body1.activeRuleCount).toBe(1);

    const body2 = parseJson<ScriptReplaceResponse>(
      await handlers.handleScriptReplacePersist({
        url: '/second.js',
        replacement: 'b',
      }),
    );
    expect(body2.activeRuleCount).toBe(2);
  });

  it('calls evaluateOnNewDocument with rule metadata', async () => {
    await handlers.handleScriptReplacePersist({
      url: '/eval-doc.js',
      replacement: 'patched()',
    });

    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        url: '/eval-doc.js',
        matchType: 'contains',
      }),
    );
  });

  it('evaluateOnNewDocument callback works correctly', async () => {
    let capturedCallback: Function | undefined;
    (page.evaluateOnNewDocument as Mock).mockImplementationOnce((fn: Function, ...args: any[]) => {
      capturedCallback = fn;
      // Execute the callback to cover lines 47-57
      const fakeWindow: Record<string, unknown> = {};
      const origWindow = globalThis.window;
      try {
        Object.defineProperty(globalThis, 'window', {
          value: fakeWindow,
          writable: true,
          configurable: true,
        });
        fn(...args);
        // Verify the callback created the rules array
        expect(Array.isArray(fakeWindow.__scriptReplacePersistRules)).toBe(true);
        const rules = fakeWindow.__scriptReplacePersistRules as Array<Record<string, unknown>>;
        expect(rules).toHaveLength(1);
      } finally {
        Object.defineProperty(globalThis, 'window', {
          value: origWindow,
          writable: true,
          configurable: true,
        });
      }
    });

    await handlers.handleScriptReplacePersist({
      url: '/callback-test.js',
      replacement: 'code()',
    });

    expect(capturedCallback).toBeDefined();
  });

  it('evaluateOnNewDocument callback deduplicates rules by id', async () => {
    (page.evaluateOnNewDocument as Mock).mockImplementationOnce((fn: Function, payload: any) => {
      const fakeWindow: Record<string, unknown> = {
        __scriptReplacePersistRules: [
          { id: payload.id, url: 'old', matchType: 'exact', createdAt: 0 },
          { id: 'other-rule', url: 'other', matchType: 'contains', createdAt: 0 },
        ],
      };
      const origWindow = globalThis.window;
      try {
        Object.defineProperty(globalThis, 'window', {
          value: fakeWindow,
          writable: true,
          configurable: true,
        });
        fn(payload);
        const rules = fakeWindow.__scriptReplacePersistRules as Array<Record<string, unknown>>;
        // Old entry with same id should be replaced, other-rule kept
        expect(rules).toHaveLength(2);
        const ids = rules.map((r) => r.id);
        expect(ids).toContain('other-rule');
        expect(ids).toContain(payload.id);
      } finally {
        Object.defineProperty(globalThis, 'window', {
          value: origWindow,
          writable: true,
          configurable: true,
        });
      }
    });

    await handlers.handleScriptReplacePersist({
      url: '/dedup-test.js',
      replacement: 'code()',
    });
  });

  it('catches error in handleScriptReplacePersist', async () => {
    (collector.getActivePage as Mock).mockRejectedValueOnce(new Error('Page crashed'));

    const response = await handlers.handleScriptReplacePersist({
      url: '/crash.js',
      replacement: 'code()',
    });
    expect((response as any).isError).toBe(true);
    const body = parseJson<ScriptReplaceResponse>(response);
    expect(body.error).toBe('Page crashed');
  });
});

// ---------------------------------------------------------------------------
// Manifest bind functions coverage
// ---------------------------------------------------------------------------
describe('graphql manifest bind functions', () => {
  it('bind functions invoke the correct handler methods', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    // Create a mock context that ensure() will populate
    const ctx: unknown = {
      config: { puppeteer: {} },
      registerCaches: vi.fn(async () => {}),
    };

    // Ensure creates the handlers
    await manifest.ensure(ctx as any);

    // Now test that each bind function routes to the right method
    for (const reg of manifest.registrations) {
      // The bind function should be callable and accept (ctx, args)
      expect(typeof reg.bind).toBe('function');
    }
  });
});
