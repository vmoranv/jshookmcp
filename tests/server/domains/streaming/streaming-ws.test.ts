import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { StreamingToolHandlersWs } from '@server/domains/streaming/handlers.impl.streaming-ws';
import type { WsFrameRecord } from '@server/domains/streaming/handlers.impl.streaming-base';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WsConnection {
  requestId: string;
  url: string;
  status: 'connecting' | 'open' | 'closed' | 'error';
  framesCount: number;
  createdTimestamp: number;
  closedTimestamp?: number;
  handshakeStatus?: number;
}

interface MonitorEnableResponse {
  success: boolean;
  error?: string;
  config: {
    maxFrames: number;
    urlFilter: string | null;
  };
  stats: {
    trackedConnections: number;
    capturedFrames: number;
  };
}

interface MonitorDisableResponse {
  success: boolean;
  summary: {
    trackedConnections: number;
    activeConnections: number;
    closedConnections: number;
    totalFrames: number;
    sentFrames: number;
    receivedFrames: number;
  };
  config: {
    maxFrames: number;
    urlFilter: string | null;
  };
}

interface FrameResponse {
  requestId: string;
  timestamp: number;
  direction: string;
  opcode: number;
  payloadLength: number;
  payloadPreview: string;
  isBinary: boolean;
}

interface ConnectionResponse {
  requestId: string;
  url: string;
  status: string;
  framesCount: number;
}

interface GetFramesResponse {
  success: boolean;
  error?: string;
  frames: FrameResponse[];
  page: {
    returned: number;
    limit: number;
    offset: number;
    totalAfterFilter: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
  monitorEnabled: boolean;
  filters: {
    direction: string;
    payloadFilter: string | null;
  };
}

interface GetConnectionsResponse {
  success: boolean;
  total: number;
  connections: ConnectionResponse[];
  monitorEnabled: boolean;
}

function makeFrame(overrides: Partial<WsFrameRecord> = {}): WsFrameRecord {
  return {
    requestId: 'req-1',
    timestamp: Date.now() / 1000,
    direction: 'sent',
    opcode: 1,
    payloadLength: 5,
    payloadPreview: 'hello',
    payloadSample: 'hello',
    isBinary: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockCDPSession {
  send: Mock;
  on: Mock;
  off: Mock;
  detach: Mock;
}

function createMocks() {
  const session: MockCDPSession = {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };

  const page = {
    createCDPSession: vi.fn(async () => session),
    evaluate: vi.fn(),
  };

  const collector = {
    getActivePage: vi.fn(async () => page),
  };

  return { session, page, collector: collector as unknown as unknown };
}

/**
 * Concrete subclass to expose protected WS internals for testing.
 */
class TestableWs extends StreamingToolHandlersWs {
  get _wsSession() {
    return this.wsSession;
  }

  set _wsSession(v) {
    this.wsSession = v;
  }

  get _wsListeners() {
    return this.wsListeners;
  }

  get _wsConfig() {
    return this.wsConfig;
  }

  get _wsConnections() {
    return this.wsConnections;
  }

  get _wsFrameOrder() {
    return this.wsFrameOrder;
  }

  get _wsFramesByRequest() {
    return this.wsFramesByRequest;
  }

  callHandleWsFrame(direction: 'sent' | 'received', params: any) {
    this.handleWsFrame(direction, params);
  }

  async callTeardownWsSession() {
    return this.teardownWsSession();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamingToolHandlersWs', () => {
  let handler: TestableWs;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
    // @ts-expect-error — auto-suppressed [TS2345]
    handler = new TestableWs(mocks.collector);
  });

  // -----------------------------------------------------------------------
  // handleWsMonitorEnable
  // -----------------------------------------------------------------------
  describe('handleWsMonitorEnable', () => {
    it('rejects invalid urlFilter regex', async () => {
      const body = parseJson<MonitorEnableResponse>(
        await handler.handleWsMonitorEnable({ urlFilter: '[' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid urlFilter regex');
    });

    it('creates CDP session and enables Network', async () => {
      const body = parseJson<MonitorEnableResponse>(await handler.handleWsMonitorEnable({}));

      expect(mocks.page.createCDPSession).toHaveBeenCalledOnce();
      expect(mocks.session.send).toHaveBeenCalledWith('Network.enable');
      expect(body.success).toBe(true);
    });

    it('registers all five CDP event listeners', async () => {
      await handler.handleWsMonitorEnable({});

      const registeredEvents = mocks.session.on.mock.calls.map((c: any[]) => c[0]);
      expect(registeredEvents).toContain('Network.webSocketCreated');
      expect(registeredEvents).toContain('Network.webSocketClosed');
      expect(registeredEvents).toContain('Network.webSocketHandshakeResponseReceived');
      expect(registeredEvents).toContain('Network.webSocketFrameSent');
      expect(registeredEvents).toContain('Network.webSocketFrameReceived');
      expect(mocks.session.on).toHaveBeenCalledTimes(5);
    });

    it('returns correct config in response', async () => {
      const body = parseJson<MonitorEnableResponse>(
        await handler.handleWsMonitorEnable({ maxFrames: 500, urlFilter: 'wss://api' }),
      );

      expect(body.config.maxFrames).toBe(500);
      expect(body.config.urlFilter).toBe('wss://api');
    });

    it('returns null urlFilter when not provided', async () => {
      const body = parseJson<MonitorEnableResponse>(await handler.handleWsMonitorEnable({}));
      expect(body.config.urlFilter).toBeNull();
    });

    it('uses default maxFrames of 1000', async () => {
      const body = parseJson<MonitorEnableResponse>(await handler.handleWsMonitorEnable({}));
      expect(body.config.maxFrames).toBe(1000);
    });

    it('clamps maxFrames to min 1', async () => {
      const body = parseJson<MonitorEnableResponse>(
        await handler.handleWsMonitorEnable({ maxFrames: -5 }),
      );
      expect(body.config.maxFrames).toBe(1);
    });

    it('clamps maxFrames to max 20000', async () => {
      const body = parseJson<MonitorEnableResponse>(
        await handler.handleWsMonitorEnable({ maxFrames: 999999 }),
      );
      expect(body.config.maxFrames).toBe(20000);
    });

    it('truncates maxFrames to integer', async () => {
      const body = parseJson<MonitorEnableResponse>(
        await handler.handleWsMonitorEnable({ maxFrames: 42.9 }),
      );
      expect(body.config.maxFrames).toBe(42);
    });

    it('tears down previous session before enabling new one', async () => {
      // Enable once
      await handler.handleWsMonitorEnable({});
      const firstSession = mocks.session;

      // Reset mocks for second call (simulate new session)
      const newSession = {
        send: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mocks.page.createCDPSession.mockResolvedValue(newSession);

      // Enable again
      await handler.handleWsMonitorEnable({});

      // First session should have been detached
      expect(firstSession.detach).toHaveBeenCalled();
    });

    it('clears previous frames and connections on re-enable', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      // Add some data
      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://x',
        status: 'open',
        framesCount: 1,
        createdTimestamp: 1,
      } as WsConnection);
      handler._wsFrameOrder.push({ requestId: 'r1', frame: makeFrame() });

      // Re-enable
      const newSession = {
        send: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mocks.page.createCDPSession.mockResolvedValue(newSession);
      await handler.handleWsMonitorEnable({});

      expect(handler._wsConnections.size).toBe(0);
      expect(handler._wsFrameOrder.length).toBe(0);
      expect(handler._wsFramesByRequest.size).toBe(0);
    });

    it('sets wsConfig to enabled state', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 500 });

      expect(handler._wsConfig.enabled).toBe(true);
      expect(handler._wsConfig.maxFrames).toBe(500);
    });

    it('returns zero stats on fresh enable', async () => {
      const body = parseJson<MonitorEnableResponse>(await handler.handleWsMonitorEnable({}));

      expect(body.stats.trackedConnections).toBe(0);
      expect(body.stats.capturedFrames).toBe(0);
    });

    it('parses maxFrames from string', async () => {
      const body = parseJson<MonitorEnableResponse>(
        await handler.handleWsMonitorEnable({ maxFrames: '250' }),
      );
      expect(body.config.maxFrames).toBe(250);
    });
  });

  // -----------------------------------------------------------------------
  // handleWsMonitorDisable
  // -----------------------------------------------------------------------
  describe('handleWsMonitorDisable', () => {
    it('returns summary with frame stats', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      handler._wsConnections.set('a', {
        requestId: 'a',
        url: 'wss://x',
        status: 'open',
        framesCount: 2,
        createdTimestamp: 1,
      } as WsConnection);

      handler._wsFrameOrder.push({
        requestId: 'a',
        frame: makeFrame({ requestId: 'a', direction: 'sent' }),
      });
      handler._wsFrameOrder.push({
        requestId: 'a',
        frame: makeFrame({ requestId: 'a', direction: 'received' }),
      });

      const body = parseJson<MonitorDisableResponse>(await handler.handleWsMonitorDisable({}));

      expect(body.success).toBe(true);
      expect(body.summary.trackedConnections).toBe(1);
      expect(body.summary.activeConnections).toBe(1);
      expect(body.summary.totalFrames).toBe(2);
      expect(body.summary.sentFrames).toBe(1);
      expect(body.summary.receivedFrames).toBe(1);
    });

    it('detaches CDP session on disable', async () => {
      await handler.handleWsMonitorEnable({});
      await handler.handleWsMonitorDisable({});

      expect(mocks.session.detach).toHaveBeenCalled();
    });

    it('reports closed connections separately from active', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      handler._wsConnections.set('a', {
        requestId: 'a',
        url: 'wss://x',
        status: 'open',
        framesCount: 0,
        createdTimestamp: 1,
      } as WsConnection);
      handler._wsConnections.set('b', {
        requestId: 'b',
        url: 'wss://y',
        status: 'closed',
        framesCount: 0,
        createdTimestamp: 2,
      } as WsConnection);
      handler._wsConnections.set('c', {
        requestId: 'c',
        url: 'wss://z',
        status: 'connecting',
        framesCount: 0,
        createdTimestamp: 3,
      } as WsConnection);

      const body = parseJson<MonitorDisableResponse>(await handler.handleWsMonitorDisable({}));

      expect(body.summary.trackedConnections).toBe(3);
      expect(body.summary.activeConnections).toBe(2); // open + connecting
      expect(body.summary.closedConnections).toBe(1);
    });

    it('returns config in summary', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 42, urlFilter: 'test' });
      const body = parseJson<MonitorDisableResponse>(await handler.handleWsMonitorDisable({}));

      expect(body.config.maxFrames).toBe(42);
      expect(body.config.urlFilter).toBe('test');
    });

    it('sets enabled to false after disable', async () => {
      await handler.handleWsMonitorEnable({});
      expect(handler._wsConfig.enabled).toBe(true);

      await handler.handleWsMonitorDisable({});
      expect(handler._wsConfig.enabled).toBe(false);
    });

    it('works even if no session was enabled', async () => {
      const body = parseJson<MonitorDisableResponse>(await handler.handleWsMonitorDisable({}));
      expect(body.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // handleWsGetFrames
  // -----------------------------------------------------------------------
  describe('handleWsGetFrames', () => {
    it('returns empty frames when nothing captured', async () => {
      const body = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({}));

      expect(body.success).toBe(true);
      expect(body.frames).toEqual([]);
      expect(body.page.returned).toBe(0);
    });

    it('returns all frames with direction=all', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({ requestId: 'r1', direction: 'sent', payloadPreview: 'A' }),
      });
      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({ requestId: 'r1', direction: 'received', payloadPreview: 'B' }),
      });

      const body = parseJson<GetFramesResponse>(
        await handler.handleWsGetFrames({ direction: 'all' }),
      );

      expect(body.frames).toHaveLength(2);
    });

    it('filters frames by direction=sent', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({ requestId: 'r1', direction: 'sent' }),
      });
      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({ requestId: 'r1', direction: 'received' }),
      });

      const body = parseJson<GetFramesResponse>(
        await handler.handleWsGetFrames({ direction: 'sent' }),
      );

      expect(body.frames).toHaveLength(1);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(body.frames[0].direction).toBe('sent');
    });

    it('filters frames by direction=received', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({ requestId: 'r1', direction: 'sent' }),
      });
      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({ requestId: 'r1', direction: 'received' }),
      });

      const body = parseJson<GetFramesResponse>(
        await handler.handleWsGetFrames({ direction: 'received' }),
      );

      expect(body.frames).toHaveLength(1);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(body.frames[0].direction).toBe('received');
    });

    it('rejects invalid payloadFilter regex', async () => {
      const body = parseJson<GetFramesResponse>(
        await handler.handleWsGetFrames({ payloadFilter: '[' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid payloadFilter regex');
    });

    it('applies payloadFilter regex to frame payloadSample', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({
          requestId: 'r1',
          payloadSample: '{"type":"ping"}',
          payloadPreview: '{"type":"ping"}',
        }),
      });
      handler._wsFrameOrder.push({
        requestId: 'r2',
        frame: makeFrame({
          requestId: 'r2',
          payloadSample: '{"type":"data","value":42}',
          payloadPreview: '{"type":"data","value":42}',
        }),
      });

      const body = parseJson<GetFramesResponse>(
        await handler.handleWsGetFrames({ payloadFilter: '"type":"data"' }),
      );

      expect(body.frames).toHaveLength(1);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(body.frames[0].payloadPreview).toContain('data');
    });

    it('applies limit to results', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      for (let i = 0; i < 5; i++) {
        handler._wsFrameOrder.push({
          requestId: `r${i}`,
          frame: makeFrame({ requestId: `r${i}`, timestamp: i }),
        });
      }

      const body = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({ limit: 2 }));

      expect(body.frames).toHaveLength(2);
      expect(body.page.returned).toBe(2);
      expect(body.page.hasMore).toBe(true);
      expect(body.page.totalAfterFilter).toBe(5);
    });

    it('applies offset to results', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      for (let i = 0; i < 5; i++) {
        handler._wsFrameOrder.push({
          requestId: `r${i}`,
          frame: makeFrame({ requestId: `r${i}`, timestamp: i }),
        });
      }

      const body = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({ offset: 3 }));

      expect(body.frames).toHaveLength(2);
      expect(body.page.offset).toBe(3);
    });

    it('provides nextOffset when more pages exist', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      for (let i = 0; i < 5; i++) {
        handler._wsFrameOrder.push({
          requestId: `r${i}`,
          frame: makeFrame({ requestId: `r${i}` }),
        });
      }

      const body = parseJson<GetFramesResponse>(
        await handler.handleWsGetFrames({ limit: 2, offset: 0 }),
      );

      expect(body.page.nextOffset).toBe(2);
      expect(body.page.hasMore).toBe(true);
    });

    it('returns null nextOffset on last page', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({ requestId: 'r1' }),
      });

      const body = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({ limit: 100 }));

      expect(body.page.nextOffset).toBeNull();
      expect(body.page.hasMore).toBe(false);
    });

    it('reports monitorEnabled status', async () => {
      const bodyDisabled = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({}));
      expect(bodyDisabled.monitorEnabled).toBe(false);

      await handler.handleWsMonitorEnable({});
      const bodyEnabled = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({}));
      expect(bodyEnabled.monitorEnabled).toBe(true);
    });

    it('includes filters in response', async () => {
      const body = parseJson<GetFramesResponse>(
        await handler.handleWsGetFrames({ direction: 'sent', payloadFilter: 'test' }),
      );

      expect(body.filters.direction).toBe('sent');
      expect(body.filters.payloadFilter).toBe('test');
    });

    it('returns null payloadFilter when not provided', async () => {
      const body = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({}));
      expect(body.filters.payloadFilter).toBeNull();
    });

    it('does not include payloadSample in output frames', async () => {
      await handler.handleWsMonitorEnable({ maxFrames: 10 });

      handler._wsFrameOrder.push({
        requestId: 'r1',
        frame: makeFrame({
          requestId: 'r1',
          payloadSample: 'full-sample-data',
          payloadPreview: 'full-sample-da...',
        }),
      });

      const body = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({}));

      expect(body.frames[0]).not.toHaveProperty('payloadSample');
      expect(body.frames[0]).toHaveProperty('payloadPreview');
    });

    it('clamps limit to min 1', async () => {
      const body = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({ limit: -10 }));
      expect(body.page.limit).toBe(1);
    });

    it('clamps limit to max 5000', async () => {
      const body = parseJson<GetFramesResponse>(await handler.handleWsGetFrames({ limit: 99999 }));
      expect(body.page.limit).toBe(5000);
    });
  });

  // -----------------------------------------------------------------------
  // handleWsGetConnections
  // -----------------------------------------------------------------------
  describe('handleWsGetConnections', () => {
    it('returns empty connections when none tracked', async () => {
      const body = parseJson<GetConnectionsResponse>(await handler.handleWsGetConnections({}));

      expect(body.success).toBe(true);
      expect(body.total).toBe(0);
      expect(body.connections).toEqual([]);
    });

    it('returns tracked connections sorted by createdTimestamp', async () => {
      handler._wsConnections.set('b', {
        requestId: 'b',
        url: 'wss://second.com',
        status: 'open',
        framesCount: 3,
        createdTimestamp: 200,
      } as any);
      handler._wsConnections.set('a', {
        requestId: 'a',
        url: 'wss://first.com',
        status: 'closed',
        framesCount: 1,
        createdTimestamp: 100,
      } as any);

      const body = parseJson<GetConnectionsResponse>(await handler.handleWsGetConnections({}));

      expect(body.total).toBe(2);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(body.connections[0].requestId).toBe('a');
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(body.connections[1].requestId).toBe('b');
    });

    it('includes required fields in each connection', async () => {
      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://example.com/ws',
        status: 'open',
        framesCount: 42,
        createdTimestamp: 1,
      } as any);

      const body = parseJson<GetConnectionsResponse>(await handler.handleWsGetConnections({}));
      const conn = body.connections[0];

      expect(conn).toHaveProperty('requestId', 'r1');
      expect(conn).toHaveProperty('url', 'wss://example.com/ws');
      expect(conn).toHaveProperty('status', 'open');
      expect(conn).toHaveProperty('framesCount', 42);
    });

    it('does not expose internal fields like createdTimestamp', async () => {
      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://x',
        status: 'open',
        framesCount: 0,
        createdTimestamp: 999,
        closedTimestamp: undefined,
        handshakeStatus: 101,
      } as any);

      const body = parseJson<GetConnectionsResponse>(await handler.handleWsGetConnections({}));
      const conn = body.connections[0];

      expect(conn).not.toHaveProperty('createdTimestamp');
      expect(conn).not.toHaveProperty('closedTimestamp');
      expect(conn).not.toHaveProperty('handshakeStatus');
    });

    it('reports monitorEnabled status', async () => {
      const body = parseJson<GetConnectionsResponse>(await handler.handleWsGetConnections({}));
      expect(body.monitorEnabled).toBe(false);

      await handler.handleWsMonitorEnable({});
      const bodyEnabled = parseJson<GetConnectionsResponse>(
        await handler.handleWsGetConnections({}),
      );
      expect(bodyEnabled.monitorEnabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // handleWsFrame (protected, tested via TestableWs)
  // -----------------------------------------------------------------------
  describe('handleWsFrame', () => {
    it('ignores params without requestId', () => {
      handler.callHandleWsFrame('sent', { response: { opcode: 1, payloadData: 'hi' } });

      expect(handler._wsFrameOrder.length).toBe(0);
    });

    it('creates connection record for untracked requestId when no URL filter', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'new-req',
        response: { opcode: 1, payloadData: 'data' },
        timestamp: 100,
      });

      expect(handler._wsConnections.has('new-req')).toBe(true);
      const conn = handler._wsConnections.get('new-req')!;
      expect(conn.url).toBe('unknown');
      expect(conn.status).toBe('open');
    });

    it('returns early when connection is not found after set (defensive guard)', () => {
      // This tests the defensive guard at line 102 in handleWsFrame.
      // Normally unreachable: after .set() on line 91, line 100 .get() always finds it.
      // We mock .get() to return undefined on the second call to simulate this edge case.
      const _originalGet = handler._wsConnections.get.bind(handler._wsConnections);
      let getCallCount = 0;
      vi.spyOn(handler._wsConnections, 'get').mockImplementation((_key: string) => {
        getCallCount++;
        if (getCallCount === 1) {
          // First call (line 85): return undefined to trigger the creation path
          return undefined;
        }
        // Second call (line 100): return undefined to hit line 102
        return undefined;
      });

      handler.callHandleWsFrame('sent', {
        requestId: 'ghost-req',
        response: { opcode: 1, payloadData: 'data' },
      });

      // Should have returned early without adding any frames
      expect(handler._wsFramesByRequest.has('ghost-req')).toBe(false);
    });

    it('skips untracked requestId when URL filter is active', async () => {
      await handler.handleWsMonitorEnable({ urlFilter: 'specific-url' });

      handler.callHandleWsFrame('sent', {
        requestId: 'untracked',
        response: { opcode: 1, payloadData: 'data' },
      });

      // The frame should not be appended since the requestId is not in wsConnections
      // and a URL filter is active
      expect(handler._wsFramesByRequest.has('untracked')).toBe(false);
    });

    it('skips frame if connection URL does not match filter', async () => {
      await handler.handleWsMonitorEnable({ urlFilter: 'api\\.example' });

      // Manually add a connection with non-matching URL
      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://other.com',
        status: 'open',
        framesCount: 0,
        createdTimestamp: 1,
      } as any);

      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { opcode: 1, payloadData: 'data' },
      });

      expect(handler._wsFramesByRequest.has('r1')).toBe(false);
    });

    it('records frame when connection URL matches filter', async () => {
      await handler.handleWsMonitorEnable({ urlFilter: 'api\\.example' });

      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://api.example.com/ws',
        status: 'open',
        framesCount: 0,
        createdTimestamp: 1,
      } as any);

      handler.callHandleWsFrame('received', {
        requestId: 'r1',
        response: { opcode: 1, payloadData: 'hello' },
        timestamp: 50,
      });

      expect(handler._wsFramesByRequest.has('r1')).toBe(true);
      const frames = handler._wsFramesByRequest.get('r1')!;
      expect(frames).toHaveLength(1);
      expect(frames[0]!.direction).toBe('received');
    });

    it('extracts opcode from response', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { opcode: 2, payloadData: 'binary' },
      });

      const frames = handler._wsFramesByRequest.get('r1')!;
      expect(frames[0]!.opcode).toBe(2);
      expect(frames[0]!.isBinary).toBe(true);
    });

    it('defaults opcode to -1 when missing', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { payloadData: 'data' },
      });

      const frames = handler._wsFramesByRequest.get('r1')!;
      expect(frames[0]!.opcode).toBe(-1);
    });

    it('handles params where response is a non-object value', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: 'not-an-object',
      });

      // Should still create a frame with default values
      const frames = handler._wsFramesByRequest.get('r1');
      expect(frames).toBeDefined();
      expect(frames![0]!.opcode).toBe(-1);
      expect(frames![0]!.payloadLength).toBe(0);
    });

    it('handles params where response is null', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'r2',
        response: null,
      });

      const frames = handler._wsFramesByRequest.get('r2');
      expect(frames).toBeDefined();
      expect(frames![0]!.opcode).toBe(-1);
    });

    it('handles params where response is entirely missing', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'r3',
      });

      const frames = handler._wsFramesByRequest.get('r3');
      expect(frames).toBeDefined();
      expect(frames![0]!.payloadPreview).toBe('');
    });

    it('handles params as a primitive value (not an object)', () => {
      // This tests asRecord returning undefined for non-object params
      handler.callHandleWsFrame('sent', 'not-an-object' as any);

      // No requestId can be extracted, so nothing should happen
      expect(handler._wsFramesByRequest.size).toBe(0);
    });

    it('handles params as null', () => {
      handler.callHandleWsFrame('sent', null as any);

      expect(handler._wsFramesByRequest.size).toBe(0);
    });

    it('defaults payloadData to empty string when missing', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { opcode: 1 },
      });

      const frames = handler._wsFramesByRequest.get('r1')!;
      expect(frames[0]!.payloadLength).toBe(0);
      expect(frames[0]!.payloadPreview).toBe('');
      expect(frames[0]!.payloadSample).toBe('');
    });

    it('truncates payloadPreview to 200 characters', () => {
      const longPayload = 'x'.repeat(300);

      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { opcode: 1, payloadData: longPayload },
      });

      const frames = handler._wsFramesByRequest.get('r1')!;
      // 200 chars + ellipsis character
      expect(frames[0]!.payloadPreview.length).toBeLessThanOrEqual(201);
    });

    it('truncates payloadSample to 2000 characters', () => {
      const longPayload = 'x'.repeat(3000);

      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { opcode: 1, payloadData: longPayload },
      });

      const frames = handler._wsFramesByRequest.get('r1')!;
      expect(frames[0]!.payloadSample.length).toBe(2000);
    });

    it('does not truncate short payloads', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { opcode: 1, payloadData: 'short' },
      });

      const frames = handler._wsFramesByRequest.get('r1')!;
      expect(frames[0]!.payloadPreview).toBe('short');
      expect(frames[0]!.payloadSample).toBe('short');
    });

    it('uses provided timestamp', () => {
      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { opcode: 1, payloadData: '' },
        timestamp: 123.456,
      });

      const frames = handler._wsFramesByRequest.get('r1')!;
      expect(frames[0]!.timestamp).toBe(123.456);
    });

    it('falls back to Date.now()/1000 when timestamp missing', () => {
      const before = Date.now() / 1000;

      handler.callHandleWsFrame('sent', {
        requestId: 'r1',
        response: { opcode: 1, payloadData: '' },
      });

      const after = Date.now() / 1000;
      const frames = handler._wsFramesByRequest.get('r1')!;
      expect(frames[0]!.timestamp).toBeGreaterThanOrEqual(before);
      expect(frames[0]!.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // -----------------------------------------------------------------------
  // teardownWsSession
  // -----------------------------------------------------------------------
  describe('teardownWsSession', () => {
    it('removes all CDP event listeners', async () => {
      await handler.handleWsMonitorEnable({});
      await handler.callTeardownWsSession();

      expect(mocks.session.off).toHaveBeenCalledTimes(5);
      const removedEvents = mocks.session.off.mock.calls.map((c: any[]) => c[0]);
      expect(removedEvents).toContain('Network.webSocketCreated');
      expect(removedEvents).toContain('Network.webSocketClosed');
      expect(removedEvents).toContain('Network.webSocketHandshakeResponseReceived');
      expect(removedEvents).toContain('Network.webSocketFrameSent');
      expect(removedEvents).toContain('Network.webSocketFrameReceived');
    });

    it('detaches CDP session', async () => {
      await handler.handleWsMonitorEnable({});
      await handler.callTeardownWsSession();

      expect(mocks.session.detach).toHaveBeenCalled();
    });

    it('nullifies session and listeners references', async () => {
      await handler.handleWsMonitorEnable({});

      expect(handler._wsSession).not.toBeNull();
      expect(handler._wsListeners).not.toBeNull();

      await handler.callTeardownWsSession();

      expect(handler._wsSession).toBeNull();
      expect(handler._wsListeners).toBeNull();
    });

    it('is safe to call when no session exists', async () => {
      await expect(handler.callTeardownWsSession()).resolves.not.toThrow();
    });

    it('handles detach failure gracefully', async () => {
      await handler.handleWsMonitorEnable({});
      mocks.session.detach.mockRejectedValue(new Error('detach failed'));

      // Should not throw
      await expect(handler.callTeardownWsSession()).resolves.not.toThrow();
      expect(handler._wsSession).toBeNull();
    });

    it('handles listener removal failure gracefully', async () => {
      await handler.handleWsMonitorEnable({});
      mocks.session.off.mockImplementation(() => {
        throw new Error('off failed');
      });

      // Should not throw
      await expect(handler.callTeardownWsSession()).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // CDP listener callbacks (via enable + simulate)
  // -----------------------------------------------------------------------
  describe('CDP listener callbacks', () => {
    let listeners: Record<string, (...args: any[]) => void>;

    beforeEach(async () => {
      await handler.handleWsMonitorEnable({});

      // Capture registered listeners
      listeners = {};
      for (const call of mocks.session.on.mock.calls) {
        listeners[call[0] as string] = call[1] as (...args: any[]) => void;
      }
    });

    describe('webSocketCreated', () => {
      it('tracks new connection', () => {
        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://example.com/ws',
        });

        expect(handler._wsConnections.has('ws-1')).toBe(true);
        const conn = handler._wsConnections.get('ws-1')!;
        expect(conn.url).toBe('wss://example.com/ws');
        expect(conn.status).toBe('connecting');
      });

      it('ignores event without requestId', () => {
        listeners['Network.webSocketCreated']!({ url: 'wss://example.com/ws' });
        expect(handler._wsConnections.size).toBe(0);
      });

      it('ignores event without url', () => {
        listeners['Network.webSocketCreated']!({ requestId: 'ws-1' });
        expect(handler._wsConnections.size).toBe(0);
      });

      it('preserves existing connection data on re-created event', () => {
        handler._wsConnections.set('ws-1', {
          requestId: 'ws-1',
          url: 'wss://old.com',
          status: 'open',
          framesCount: 5,
          createdTimestamp: 100,
          handshakeStatus: 101,
        } as any);

        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://new.com',
        });

        const conn = handler._wsConnections.get('ws-1')!;
        expect(conn.url).toBe('wss://new.com');
        expect(conn.status).toBe('open');
        expect(conn.framesCount).toBe(5);
      });
    });

    describe('webSocketClosed', () => {
      it('updates connection status to closed', () => {
        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://example.com/ws',
        });

        listeners['Network.webSocketClosed']!({
          requestId: 'ws-1',
          timestamp: 999,
        });

        const conn = handler._wsConnections.get('ws-1')!;
        expect(conn.status).toBe('closed');
        expect(conn.closedTimestamp).toBe(999);
      });

      it('ignores close for unknown connection', () => {
        listeners['Network.webSocketClosed']!({ requestId: 'unknown' });
        expect(handler._wsConnections.has('unknown')).toBe(false);
      });

      it('ignores close without requestId', () => {
        listeners['Network.webSocketClosed']!({});
        // Should not throw
      });

      it('uses Date.now()/1000 when timestamp not provided', () => {
        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://x',
        });

        const before = Date.now() / 1000;
        listeners['Network.webSocketClosed']!({ requestId: 'ws-1' });
        const after = Date.now() / 1000;

        const conn = handler._wsConnections.get('ws-1')!;
        expect(conn.closedTimestamp).toBeGreaterThanOrEqual(before);
        expect(conn.closedTimestamp).toBeLessThanOrEqual(after);
      });
    });

    describe('webSocketHandshakeResponseReceived', () => {
      it('updates handshakeStatus and sets open for successful status', () => {
        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://example.com/ws',
        });

        listeners['Network.webSocketHandshakeResponseReceived']!({
          requestId: 'ws-1',
          response: { status: 101 },
        });

        const conn = handler._wsConnections.get('ws-1')!;
        expect(conn.handshakeStatus).toBe(101);
        expect(conn.status).toBe('open');
      });

      it('sets error for 4xx handshake status', () => {
        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://example.com/ws',
        });

        listeners['Network.webSocketHandshakeResponseReceived']!({
          requestId: 'ws-1',
          response: { status: 403 },
        });

        const conn = handler._wsConnections.get('ws-1')!;
        expect(conn.status).toBe('error');
      });

      it('sets open for 1xx-3xx status range', () => {
        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://example.com/ws',
        });

        listeners['Network.webSocketHandshakeResponseReceived']!({
          requestId: 'ws-1',
          response: { status: 200 },
        });

        const conn = handler._wsConnections.get('ws-1')!;
        expect(conn.status).toBe('open');
      });

      it('ignores handshake for unknown connection', () => {
        listeners['Network.webSocketHandshakeResponseReceived']!({
          requestId: 'unknown',
          response: { status: 101 },
        });
        expect(handler._wsConnections.has('unknown')).toBe(false);
      });

      it('ignores handshake without requestId', () => {
        listeners['Network.webSocketHandshakeResponseReceived']!({
          response: { status: 101 },
        });
        // Should not throw
      });
    });

    describe('webSocketFrameSent', () => {
      it('captures sent frame', () => {
        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://example.com/ws',
        });

        listeners['Network.webSocketFrameSent']!({
          requestId: 'ws-1',
          response: { opcode: 1, payloadData: 'hello' },
          timestamp: 100,
        });

        expect(handler._wsFramesByRequest.has('ws-1')).toBe(true);
        const frames = handler._wsFramesByRequest.get('ws-1')!;
        expect(frames[0]!.direction).toBe('sent');
      });
    });

    describe('webSocketFrameReceived', () => {
      it('captures received frame', () => {
        listeners['Network.webSocketCreated']!({
          requestId: 'ws-1',
          url: 'wss://example.com/ws',
        });

        listeners['Network.webSocketFrameReceived']!({
          requestId: 'ws-1',
          response: { opcode: 1, payloadData: 'world' },
          timestamp: 200,
        });

        expect(handler._wsFramesByRequest.has('ws-1')).toBe(true);
        const frames = handler._wsFramesByRequest.get('ws-1')!;
        expect(frames[0]!.direction).toBe('received');
      });
    });
  });

  // -----------------------------------------------------------------------
  // URL filter integration
  // -----------------------------------------------------------------------
  describe('URL filter integration', () => {
    it('filters connections by URL on created event', async () => {
      await handler.handleWsMonitorEnable({ urlFilter: 'api\\.example' });

      const listeners: Record<string, (...args: any[]) => void> = {};
      for (const call of mocks.session.on.mock.calls) {
        listeners[call[0] as string] = call[1] as (...args: any[]) => void;
      }

      listeners['Network.webSocketCreated']!({
        requestId: 'match',
        url: 'wss://api.example.com/ws',
      });
      listeners['Network.webSocketCreated']!({
        requestId: 'no-match',
        url: 'wss://other.com/ws',
      });

      expect(handler._wsConnections.has('match')).toBe(true);
      expect(handler._wsConnections.has('no-match')).toBe(false);
    });
  });
});
