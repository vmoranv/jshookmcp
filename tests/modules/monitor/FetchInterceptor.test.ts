import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const uuidState = vi.hoisted(() => ({
  counter: 0,
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

// Mock crypto.randomUUID to return predictable but unique IDs
// Source code uses .slice(0, 8) on the UUID, so the first 8 chars must be unique
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomUUID: () => {
      const n = ++uuidState.counter;
      // Ensure the first 8 chars are unique per call
      return `r${String(n).padStart(7, '0')}-0000-0000-0000-000000000000`;
    },
  };
});

import { FetchInterceptor } from '@modules/monitor/FetchInterceptor';

function createMockSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  const send = vi.fn(async (..._args: any[]) => ({}));
  const on = vi.fn((event: string, handler: (payload: any) => void) => {
    const group = listeners.get(event) ?? new Set<(payload: any) => void>();
    group.add(handler);
    listeners.set(event, group);
  });
  const off = vi.fn((event: string, handler: (payload: any) => void) => {
    listeners.get(event)?.delete(handler);
  });

  const emit = (event: string, payload: any) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };

  return {
    session: { send, on, off } as any,
    send,
    emit,
    on,
    off,
  };
}

describe('FetchInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggerState.debug.mockReset();
    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();
    uuidState.counter = 0; // Reset counter for consistent tests
  });

  // ── enable ────────────────────────────────────────────────────────────
  describe('enable', () => {
    it('creates rules and enables Fetch domain', async () => {
      const { session, send } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      const rules = await interceptor.enable([{ urlPattern: '*api/test*' }]);

      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        urlPattern: '*api/test*',
        urlPatternType: 'glob',
        stage: 'Response',
        responseCode: 200,
        responseHeaders: [],
        responseBody: '',
        hitCount: 0,
      });
      expect(rules[0]?.id).toBe('r0000001');
      expect(send).toHaveBeenCalledWith('Fetch.disable');
      expect(send).toHaveBeenCalledWith(
        'Fetch.enable',
        expect.objectContaining({
          patterns: expect.any(Array),
          handleAuthRequests: false,
        }),
      );
      expect(interceptor.isEnabled()).toBe(true);
    });

    it('applies default values for optional rule fields', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      const rules = await interceptor.enable([{ urlPattern: '*test*' }]);

      expect(rules[0]).toMatchObject({
        urlPatternType: 'glob',
        stage: 'Response',
        responseCode: 200,
        responseBody: '',
        responseHeaders: [],
      });
    });

    it('converts responseHeaders object to array format', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      const rules = await interceptor.enable([
        {
          urlPattern: '*test*',
          responseHeaders: {
            'Content-Type': 'application/json',
            'X-Custom': 'value',
          },
        },
      ]);

      expect(rules[0]?.responseHeaders).toEqual([
        { name: 'Content-Type', value: 'application/json' },
        { name: 'X-Custom', value: 'value' },
      ]);
    });

    it('supports regex urlPatternType', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      const rules = await interceptor.enable([
        {
          urlPattern: '/api/v[12]/users',
          urlPatternType: 'regex',
          stage: 'Request',
        },
      ]);

      expect(rules[0]).toMatchObject({
        urlPattern: '/api/v[12]/users',
        urlPatternType: 'regex',
        stage: 'Request',
      });
    });

    it('merges new rules with existing ones on subsequent enable calls', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*first*' }]);
      const secondRules = await interceptor.enable([{ urlPattern: '*second*' }]);

      const status = interceptor.listRules();
      expect(status.rules).toHaveLength(2);
      expect(secondRules).toHaveLength(1);
    });

    it('reuses event handler on subsequent enable calls', async () => {
      const { session, on } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*first*' }]);
      await interceptor.enable([{ urlPattern: '*second*' }]);

      // Should only register event handler once
      const fetchHandlerCalls = on.mock.calls.filter(([event]) => event === 'Fetch.requestPaused');
      expect(fetchHandlerCalls).toHaveLength(1);
    });

    it('throws when Fetch.enable fails', async () => {
      const { session, send } = createMockSession();
      send.mockImplementation(async (method: string) => {
        if (method === 'Fetch.enable') {
          throw new Error('CDP error');
        }
        return {};
      });

      const interceptor = new FetchInterceptor(session);

      await expect(interceptor.enable([{ urlPattern: '*test*' }])).rejects.toThrow('CDP error');
      expect(loggerState.error).toHaveBeenCalled();
    });
  });

  // ── disable ───────────────────────────────────────────────────────────
  describe('disable', () => {
    it('removes all rules and disables Fetch domain', async () => {
      const { session, send, off } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*test*' }]);
      const result = await interceptor.disable();

      expect(result).toEqual({ removedRules: 1 });
      expect(send).toHaveBeenCalledWith('Fetch.disable');
      expect(interceptor.isEnabled()).toBe(false);
      expect(interceptor.listRules().rules).toHaveLength(0);
      expect(off).toHaveBeenCalledWith('Fetch.requestPaused', expect.any(Function));
    });

    it('handles Fetch.disable failure gracefully', async () => {
      const { session, send } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*test*' }]);

      send.mockImplementation(async (method: string) => {
        if (method === 'Fetch.disable') {
          throw new Error('Already disabled');
        }
        return {};
      });

      const result = await interceptor.disable();

      expect(result).toEqual({ removedRules: 1 });
      expect(loggerState.warn).toHaveBeenCalled();
      expect(interceptor.isEnabled()).toBe(false);
    });

    it('handles off() failure gracefully', async () => {
      const { session, off } = createMockSession();
      off.mockImplementation(() => {
        throw new Error('Handler not found');
      });

      const interceptor = new FetchInterceptor(session);
      await interceptor.enable([{ urlPattern: '*test*' }]);

      // Should not throw
      const result = await interceptor.disable();
      expect(result).toEqual({ removedRules: 1 });
    });

    it('returns zero when no rules exist', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      const result = await interceptor.disable();

      expect(result).toEqual({ removedRules: 0 });
    });
  });

  // ── removeRule ────────────────────────────────────────────────────────
  describe('removeRule', () => {
    it('removes a specific rule by ID', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      const rules = await interceptor.enable([{ urlPattern: '*test*' }]);
      const ruleId = rules[0]!.id;

      const removed = await interceptor.removeRule(ruleId);

      expect(removed).toBe(true);
      expect(interceptor.listRules().rules).toHaveLength(0);
      expect(interceptor.isEnabled()).toBe(false);
    });

    it('returns false for unknown rule ID', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*test*' }]);

      const removed = await interceptor.removeRule('unknown-id');

      expect(removed).toBe(false);
      expect(interceptor.listRules().rules).toHaveLength(1);
    });

    it('reapplies rules when rules remain after removal', async () => {
      const { session, send } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      // UUID counter generates unique IDs for each rule
      const rules = await interceptor.enable([
        { urlPattern: '*first*' },
        { urlPattern: '*second*' },
      ]);

      expect(rules).toHaveLength(2);
      expect(rules[0]!.id).not.toBe(rules[1]!.id);

      send.mockClear();

      await interceptor.removeRule(rules[0]!.id);

      expect(interceptor.listRules().rules).toHaveLength(1);
      expect(interceptor.isEnabled()).toBe(true);
      // Should have called applyRules
      expect(send).toHaveBeenCalledWith('Fetch.disable');
      expect(send).toHaveBeenCalledWith('Fetch.enable', expect.anything());
    });
  });

  // ── listRules ─────────────────────────────────────────────────────────
  describe('listRules', () => {
    it('returns enabled status and rules with total hits', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*test*' }, { urlPattern: '*api*' }]);

      const status = interceptor.listRules();

      expect(status.enabled).toBe(true);
      expect(status.rules).toHaveLength(2);
      expect(status.totalHits).toBe(0);
    });

    it('returns disabled status when not enabled', () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      const status = interceptor.listRules();

      expect(status.enabled).toBe(false);
      expect(status.rules).toHaveLength(0);
      expect(status.totalHits).toBe(0);
    });
  });

  // ── isEnabled ─────────────────────────────────────────────────────────
  describe('isEnabled', () => {
    it('returns false initially', () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      expect(interceptor.isEnabled()).toBe(false);
    });

    it('returns true after enable', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*test*' }]);

      expect(interceptor.isEnabled()).toBe(true);
    });

    it('returns false after disable', async () => {
      const { session } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*test*' }]);
      await interceptor.disable();

      expect(interceptor.isEnabled()).toBe(false);
    });
  });

  // ── handleRequestPaused ───────────────────────────────────────────────
  describe('handleRequestPaused (via emit)', () => {
    it('matches glob pattern and fulfills request', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([
        {
          urlPattern: '*api/users*',
          responseCode: 201,
          responseBody: '{"users":[]}',
        },
      ]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: {
          url: 'https://example.com/api/users?page=1',
          method: 'GET',
          headers: {},
        },
      });

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith('Fetch.fulfillRequest', {
        requestId: 'req-1',
        responseCode: 201,
        responseHeaders: expect.arrayContaining([
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ]),
        body: expect.any(String),
      });

      const status = interceptor.listRules();
      expect(status.totalHits).toBe(1);
    });

    it('matches regex pattern', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([
        {
          urlPattern: '/api/v[12]/users',
          urlPatternType: 'regex',
          responseBody: '[]',
        },
      ]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: {
          url: 'https://example.com/api/v1/users',
          method: 'GET',
          headers: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith('Fetch.fulfillRequest', expect.anything());
    });

    it('falls back to literal match when regex is invalid', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      // Invalid regex pattern
      await interceptor.enable([
        {
          urlPattern: '[invalid(regex',
          urlPatternType: 'regex',
          responseBody: 'matched',
        },
      ]);

      send.mockClear();

      // Should match literally
      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: {
          url: 'https://example.com/[invalid(regex',
          method: 'GET',
          headers: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith('Fetch.fulfillRequest', expect.anything());
    });

    it('continues request when no rule matches', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*api/users*' }]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: {
          url: 'https://example.com/api/products',
          method: 'GET',
          headers: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith('Fetch.continueRequest', {
        requestId: 'req-1',
      });
    });

    it('continues response when no rule matches at response stage', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*api/users*' }]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: {
          url: 'https://example.com/api/products',
          method: 'GET',
          headers: {},
        },
        responseStatusCode: 200,
        responseHeaders: [],
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith('Fetch.continueResponse', {
        requestId: 'req-1',
      });
    });

    it('auto-detects JSON content type from body', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([
        {
          urlPattern: '*test*',
          responseBody: '{"key":"value"}',
        },
      ]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/test', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith(
        'Fetch.fulfillRequest',
        expect.objectContaining({
          responseHeaders: expect.arrayContaining([
            { name: 'Content-Type', value: 'application/json' },
          ]),
        }),
      );
    });

    it('auto-detects JSON array content type from body', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([
        {
          urlPattern: '*test*',
          responseBody: '[1,2,3]',
        },
      ]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/test', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith(
        'Fetch.fulfillRequest',
        expect.objectContaining({
          responseHeaders: expect.arrayContaining([
            { name: 'Content-Type', value: 'application/json' },
          ]),
        }),
      );
    });

    it('uses text/plain for non-JSON body', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([
        {
          urlPattern: '*test*',
          responseBody: 'plain text',
        },
      ]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/test', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith(
        'Fetch.fulfillRequest',
        expect.objectContaining({
          responseHeaders: expect.arrayContaining([{ name: 'Content-Type', value: 'text/plain' }]),
        }),
      );
    });

    it('preserves existing Content-Type header', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([
        {
          urlPattern: '*test*',
          responseBody: '<html></html>',
          responseHeaders: {
            'content-type': 'text/html',
          },
        },
      ]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/test', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const fulfillCall = send.mock.calls.find(([method]) => method === 'Fetch.fulfillRequest');
      const headers = fulfillCall?.[1]?.responseHeaders as Array<{ name: string; value: string }>;

      // Should have only one Content-Type header (the custom one)
      const contentTypes = headers?.filter((h) => h.name.toLowerCase() === 'content-type');
      expect(contentTypes).toHaveLength(1);
      expect(contentTypes?.[0]?.value).toBe('text/html');
    });

    it('preserves existing Access-Control-Allow-Origin header', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([
        {
          urlPattern: '*test*',
          responseHeaders: {
            'Access-Control-Allow-Origin': 'https://specific.com',
          },
        },
      ]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/test', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const fulfillCall = send.mock.calls.find(([method]) => method === 'Fetch.fulfillRequest');
      const headers = fulfillCall?.[1]?.responseHeaders as Array<{ name: string; value: string }>;

      const corsHeaders = headers?.filter(
        (h) => h.name.toLowerCase() === 'access-control-allow-origin',
      );
      expect(corsHeaders).toHaveLength(1);
      expect(corsHeaders?.[0]?.value).toBe('https://specific.com');
    });

    it('handles fulfillRequest failure gracefully', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*test*', responseBody: 'data' }]);

      send.mockImplementation(async (method: string) => {
        if (method === 'Fetch.fulfillRequest') {
          throw new Error('Network error');
        }
        return {};
      });

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/test', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loggerState.error).toHaveBeenCalled();
      // Should fall through to continueRequest
      expect(send).toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'req-1' });
    });

    it('handles continueRequest failure gracefully', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*nomatch*' }]);

      send.mockImplementation(async (method: string) => {
        if (method === 'Fetch.continueRequest') {
          throw new Error('Request already handled');
        }
        return {};
      });

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/other', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loggerState.warn).toHaveBeenCalled();
    });

    it('handles continueResponse failure gracefully', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*nomatch*' }]);

      send.mockImplementation(async (method: string) => {
        if (method === 'Fetch.continueResponse') {
          throw new Error('Response already handled');
        }
        return {};
      });

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/other', method: 'GET', headers: {} },
        responseStatusCode: 200,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(loggerState.warn).toHaveBeenCalled();
    });
  });

  // ── glob pattern compilation ──────────────────────────────────────────
  describe('glob pattern compilation', () => {
    it('handles ** globstar for any path', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '**/api/**', responseBody: 'matched' }]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/v1/api/users/123', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith('Fetch.fulfillRequest', expect.anything());
    });

    it('handles * for single segment', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*/api/*/users', responseBody: 'matched' }]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/api/v1/users', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith('Fetch.fulfillRequest', expect.anything());
    });

    it('escapes regex special characters in glob pattern', async () => {
      const { session, send, emit } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*api/users?id=1', responseBody: 'matched' }]);

      send.mockClear();

      await emit('Fetch.requestPaused', {
        requestId: 'req-1',
        request: { url: 'https://example.com/api/users?id=1', method: 'GET', headers: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(send).toHaveBeenCalledWith('Fetch.fulfillRequest', expect.anything());
    });
  });

  // ── applyRules edge cases ─────────────────────────────────────────────
  describe('applyRules edge cases', () => {
    it('uses wildcard pattern for regex rules', async () => {
      const { session, send } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '/api/v[12]/', urlPatternType: 'regex' }]);

      const enableCall = send.mock.calls.find(([method]) => method === 'Fetch.enable');
      expect(enableCall?.[1]?.patterns).toEqual([{ urlPattern: '*', requestStage: 'Response' }]);
    });

    it('uses actual pattern for glob rules', async () => {
      const { session, send } = createMockSession();
      const interceptor = new FetchInterceptor(session);

      await interceptor.enable([{ urlPattern: '*api*', urlPatternType: 'glob', stage: 'Request' }]);

      const enableCall = send.mock.calls.find(([method]) => method === 'Fetch.enable');
      expect(enableCall?.[1]?.patterns).toContainEqual(
        expect.objectContaining({ urlPattern: '*api*', requestStage: 'Request' }),
      );
    });
  });
});
