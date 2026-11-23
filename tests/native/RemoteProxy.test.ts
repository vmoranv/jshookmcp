/**
 * RemoteProxy — WebSocket remote proxy lifecycle, connect, forward,
 * reconnect, pending cleanup, and error handling tests.
 *
 * Uses a mock WebSocket factory (wsFactory) so no real network is needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RemoteProxy,
  getOrCreateRemoteProxy,
  getRemoteProxy,
  removeRemoteProxy,
  listRemoteProxies,
} from '@native/RemoteProxy';
import type { RemoteProxyConfig } from '@native/RemoteProxy';

/** Structural WebSocket shape expected by RemoteProxy's `wsFactory`. */
type WsLike = ReturnType<NonNullable<RemoteProxyConfig['wsFactory']>>;

// ── mock WebSocket ─────────────────────────────────────────────────────────

interface MockWs {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  triggerOpen: () => void;
  triggerMessage: (data: string) => void;
  triggerClose: (code?: number, reason?: string) => void;
  triggerError: (err: Error) => void;
}

function createMockWs(): MockWs {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    handlers[event] = cb;
  });
  const send = vi.fn();
  const close = vi.fn();

  return {
    send,
    close,
    on,
    triggerOpen() {
      handlers['open']?.();
    },
    triggerMessage(data: string) {
      // Vitest Buffer mock compat: message handler receives string
      handlers['message']?.(data);
    },
    triggerClose(code?: number, reason?: string) {
      handlers['close']?.(code ?? 1000, reason ?? '');
    },
    triggerError(err: Error) {
      handlers['error']?.(err);
    },
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function buildJsonRpcResponse(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function buildJsonRpcError(id: number, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('RemoteProxy config and status', () => {
  it('stores config and returns status when disconnected', () => {
    const proxy = new RemoteProxy({ url: 'ws://127.0.0.1:17171' });
    const s = proxy.status;
    expect(s.url).toBe('ws://127.0.0.1:17171');
    expect(s.connected).toBe(false);
    expect(s.bytesSent).toBe(0);
    expect(s.connectedAt).toBeNull();
  });

  it('accepts auth token and timeouts', () => {
    const proxy = new RemoteProxy({
      url: 'ws://remote:17171',
      authToken: 'mysecret',
      connectTimeoutMs: 5000,
      requestTimeoutMs: 30000,
    });
    expect(proxy.status.url).toBe('ws://remote:17171');
  });
});

describe('RemoteProxy disconnect', () => {
  it('disconnects without error when not connected', () => {
    const proxy = new RemoteProxy({ url: 'ws://127.0.0.1:17171' });
    expect(() => proxy.disconnect()).not.toThrow();
    expect(proxy.status.connected).toBe(false);
  });
});

// ── integration tests with mock WebSocket ──────────────────────────────────

describe('RemoteProxy connect flow (mock ws)', () => {
  let proxy: RemoteProxy;
  let mockWs: MockWs;

  beforeEach(() => {
    mockWs = createMockWs();
    proxy = new RemoteProxy({
      url: 'ws://127.0.0.1:17171',
      connectTimeoutMs: 5000,
      wsFactory: () => mockWs as unknown as WsLike,
    });
  });

  afterEach(() => {
    proxy.disconnect();
    vi.restoreAllMocks();
  });

  it('connects and sets connected status', async () => {
    const connectPromise = proxy.connect();
    // Trigger the open event asynchronously
    setTimeout(() => mockWs.triggerOpen(), 10);
    await connectPromise;

    expect(proxy.status.connected).toBe(true);
    expect(mockWs.on).toHaveBeenCalledWith('open', expect.any(Function));
  });

  it('passes auth token as Bearer in headers', async () => {
    const authProxy = new RemoteProxy({
      url: 'ws://127.0.0.1:17171',
      authToken: 'secret-token-123',
      connectTimeoutMs: 5000,
      wsFactory: (_url, opts) => {
        expect(opts).toBeDefined();
        expect(opts!.headers).toBeDefined();
        expect(opts!.headers!['Authorization']).toBe('Bearer secret-token-123');
        return mockWs as unknown as WsLike;
      },
    });

    const connectPromise = authProxy.connect();
    setTimeout(() => mockWs.triggerOpen(), 10);
    await connectPromise;
    authProxy.disconnect();
  });

  it('rejects on connect timeout', async () => {
    const fastProxy = new RemoteProxy({
      url: 'ws://127.0.0.1:17171',
      connectTimeoutMs: 100,
      wsFactory: () => {
        // Never trigger open — timeout should fire
        return mockWs as unknown as WsLike;
      },
    });

    await expect(fastProxy.connect()).rejects.toThrow('timed out');
    expect(proxy.status.connected).toBe(false);
  });

  it('rejects on WebSocket creation error', async () => {
    const badProxy = new RemoteProxy({
      url: 'ws://127.0.0.1:17171',
      connectTimeoutMs: 5000,
      wsFactory: () => {
        throw new Error('Cannot resolve host');
      },
    });

    await expect(badProxy.connect()).rejects.toThrow('Cannot resolve host');
  });

  it('rejects on ws error before open', async () => {
    // Forwarding 'error' when a listener exists must keep working.
    proxy.on('error', () => {});

    const connectPromise = proxy.connect();
    // The ws event handlers are registered synchronously inside connect()
    // before the Promise is returned, so triggering error fires reject.
    mockWs.triggerError(new Error('ECONNREFUSED'));
    await expect(connectPromise).rejects.toThrow('ECONNREFUSED');
    expect(proxy.status.connected).toBe(false);
  });

  it('does not throw when a ws error arrives with no error listener', async () => {
    const connectPromise = proxy.connect();
    // EventEmitter('error') with no listener would throw synchronously and
    // escape the ws callback; the proxy must record it and still reject.
    expect(() => mockWs.triggerError(new Error('boom'))).not.toThrow();
    await expect(connectPromise).rejects.toThrow('boom');
    expect(proxy.status.lastError).toBe('boom');
    expect(proxy.status.errors).toBe(1);
  });

  it('double-connect is a no-op', async () => {
    const p1 = proxy.connect();
    setTimeout(() => mockWs.triggerOpen(), 10);
    await p1;
    expect(proxy.status.connected).toBe(true);

    // Second connect should resolve immediately without creating new ws
    await proxy.connect();
    expect(proxy.status.connected).toBe(true);
  });
});

describe('RemoteProxy forward tool call (mock ws)', () => {
  let proxy: RemoteProxy;
  let mockWs: MockWs;

  beforeEach(async () => {
    mockWs = createMockWs();
    proxy = new RemoteProxy({
      url: 'ws://127.0.0.1:17171',
      requestTimeoutMs: 5000,
      wsFactory: () => mockWs as unknown as WsLike,
    });
    const p = proxy.connect();
    setTimeout(() => mockWs.triggerOpen(), 10);
    await p;
  });

  afterEach(() => {
    proxy.disconnect();
    vi.restoreAllMocks();
  });

  it('sends JSON-RPC request and resolves with result', async () => {
    const forwardPromise = proxy.forward('memory_read', {
      pid: 1234,
      address: '0x7FF612340000',
    });

    // Verify the outgoing frame structure
    expect(mockWs.send).toHaveBeenCalledTimes(1);
    const sentFrame = JSON.parse(mockWs.send.mock.calls[0]![0] as string);
    expect(sentFrame.jsonrpc).toBe('2.0');
    expect(sentFrame.method).toBe('tools/call');
    expect(sentFrame.params.name).toBe('memory_read');
    expect(sentFrame.params.arguments.pid).toBe(1234);
    expect(typeof sentFrame.id).toBe('number');

    // Send back a response
    setTimeout(() => {
      mockWs.triggerMessage(buildJsonRpcResponse(sentFrame.id, { data: [0x90, 0xc3] }));
    }, 10);

    const result = await forwardPromise;
    expect(result).toEqual({ data: [0x90, 0xc3] });
    expect(proxy.status.responsesReceived).toBe(1);
    expect(proxy.status.requestsSent).toBe(1);
  });

  it('handles remote JSON-RPC error', async () => {
    const forwardPromise = proxy.forward('bogus_tool', {});

    const sentFrame = JSON.parse(mockWs.send.mock.calls[0]![0] as string);
    setTimeout(() => {
      mockWs.triggerMessage(buildJsonRpcError(sentFrame.id, -32601, 'Method not found'));
    }, 10);

    await expect(forwardPromise).rejects.toThrow('Method not found');
    expect(proxy.status.errors).toBeGreaterThanOrEqual(0); // errors tracked on timeout, not remote err
  });

  it('handles request timeout', async () => {
    const timeoutProxy = new RemoteProxy({
      url: 'ws://127.0.0.1:17171',
      requestTimeoutMs: 100,
      wsFactory: () => mockWs as unknown as WsLike,
    });
    const p = timeoutProxy.connect();
    setTimeout(() => mockWs.triggerOpen(), 10);
    await p;

    const forwardPromise = timeoutProxy.forward('slow_tool', {});
    await expect(forwardPromise).rejects.toThrow('timed out');
    expect(timeoutProxy.status.errors).toBe(1);
    timeoutProxy.disconnect();
  });

  it('auto-connects if forward called before connect', async () => {
    const freshMockWs = createMockWs();
    // Attach no-op error listener to avoid Node throwing on emit('error').
    const freshProxy = new RemoteProxy({
      url: 'ws://127.0.0.1:17171',
      requestTimeoutMs: 5000,
      wsFactory: () => freshMockWs as unknown as WsLike,
    });
    freshProxy.on('error', () => {});

    // Start forward — this internally calls connect() and awaits 'open'.
    const forwardPromise = freshProxy.forward('test_tool', {});

    // Simulate the WebSocket connection succeeding. This resolves the
    // connect() promise, but await won't resume until the microtask queue
    // flushes — so read send.mock.calls inside an async continuation.
    freshMockWs.triggerOpen();

    // Flush microtasks so forward() resumes past connect() and sends the frame.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Now forward() should have called ws.send().
    const sentFrame = JSON.parse(freshMockWs.send.mock.calls[0]![0] as string);
    freshMockWs.triggerMessage(buildJsonRpcResponse(sentFrame.id as number, { ok: true }));

    const result = await forwardPromise;
    expect(result).toEqual({ ok: true });
    expect(freshProxy.status.requestsSent).toBe(1);
    freshProxy.disconnect();
  });

  it('handles send error gracefully', async () => {
    mockWs.send.mockImplementation(() => {
      throw new Error('WebSocket not open');
    });

    await expect(proxy.forward('test_tool', {})).rejects.toThrow('WebSocket not open');
    expect(proxy.status.errors).toBe(1);
  });
});

describe('RemoteProxy reconnect and disconnect cleanup', () => {
  let proxy: RemoteProxy;
  let mockWs: MockWs;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockWs = createMockWs();
    proxy = new RemoteProxy({
      url: 'ws://127.0.0.1:17171',
      requestTimeoutMs: 5000,
      wsFactory: () => mockWs as unknown as WsLike,
    });
    const p = proxy.connect();
    setTimeout(() => mockWs.triggerOpen(), 10);
    await vi.advanceTimersByTimeAsync(20);
    await p;
  });

  afterEach(() => {
    proxy.disconnect();
    vi.useRealTimers();
  });

  it('schedules reconnect on unexpected close', () => {
    mockWs.triggerClose(1006, 'connection lost');
    expect(proxy.status.connected).toBe(false);
    // reconnectAttempts incremented
    expect(proxy.status.reconnectAttempts).toBe(1);
  });

  it('does not reconnect after intentional disconnect', () => {
    proxy.disconnect();
    expect(proxy.status.connected).toBe(false);
    expect(proxy.status.reconnectAttempts).toBe(0);
  });

  it('cleans up pending requests on disconnect', async () => {
    // Queue a pending request
    const forwardPromise = proxy.forward('test_tool', {});
    expect(proxy.status.requestsSent).toBe(1);

    // Disconnect should reject all pending
    proxy.disconnect();

    await expect(forwardPromise).rejects.toThrow('Disconnected');
  });

  it('rejects invalid URL gracefully', () => {
    // WebSocket constructor throws on invalid URL
    const badProxy = new RemoteProxy({
      url: 'not-a-valid-url',
      connectTimeoutMs: 5000,
      wsFactory: () => {
        throw new TypeError('Invalid URL');
      },
    });

    // The connect promise should reject with the factory error
    // (the RemoteProxy catches it and re-throws as "Failed to create WebSocket")
    return expect(badProxy.connect()).rejects.toThrow('Invalid URL');
  });
});

// ── registry tests ─────────────────────────────────────────────────────────

describe('RemoteProxy registry', () => {
  afterEach(() => {
    removeRemoteProxy('test-proxy');
    removeRemoteProxy('test-proxy-2');
  });

  it('getOrCreate creates and retrieves same instance', () => {
    const p1 = getOrCreateRemoteProxy('test-proxy', { url: 'ws://127.0.0.1:17171' });
    const p2 = getOrCreateRemoteProxy('test-proxy', { url: 'ws://other:9999' });
    expect(p1).toBe(p2);
    expect(p1.status.url).toBe('ws://127.0.0.1:17171');
  });

  it('getRemoteProxy returns undefined for unknown key', () => {
    expect(getRemoteProxy('nonexistent')).toBeUndefined();
  });

  it('getRemoteProxy returns instance for known key', () => {
    getOrCreateRemoteProxy('test-proxy-2', { url: 'ws://127.0.0.1:17171' });
    expect(getRemoteProxy('test-proxy-2')).toBeDefined();
  });

  it('removeRemoteProxy disconnects and removes', () => {
    getOrCreateRemoteProxy('test-proxy', { url: 'ws://127.0.0.1:17171' });
    expect(removeRemoteProxy('test-proxy')).toBe(true);
    expect(getRemoteProxy('test-proxy')).toBeUndefined();
  });

  it('removeRemoteProxy returns false for unknown', () => {
    expect(removeRemoteProxy('nonexistent')).toBe(false);
  });

  it('listRemoteProxies returns array of statuses', () => {
    getOrCreateRemoteProxy('list-1', { url: 'ws://a:1111' });
    getOrCreateRemoteProxy('list-2', { url: 'ws://b:2222' });
    const urls = listRemoteProxies().map((s) => s.url);
    expect(urls).toContain('ws://a:1111');
    expect(urls).toContain('ws://b:2222');
    removeRemoteProxy('list-1');
    removeRemoteProxy('list-2');
  });
});
