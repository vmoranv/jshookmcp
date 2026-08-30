import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSONRPCRequest, JSONRPCResultResponse } from '@modelcontextprotocol/server';

const mocks = vi.hoisted(() => {
  const innerTransports: any[] = [];
  const innerTransportOptions: any[] = [];
  // When true, the next inner transport construction throws — simulates an
  // inner-transport setup failure after the admission hook claimed a lease.
  let failNextConstruct = false;

  return {
    innerTransports,
    innerTransportOptions,
    get failNextConstruct() {
      return failNextConstruct;
    },
    set failNextConstruct(value: boolean) {
      failNextConstruct = value;
    },
  };
});

vi.mock('@modelcontextprotocol/node', () => ({
  NodeStreamableHTTPServerTransport: class MockStreamableHTTPServerTransport {
    private readonly options: { sessionIdGenerator: () => string; enableJsonResponse?: boolean };
    public sessionId?: string;
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    public onmessage?: (message: any, extra?: any) => void;
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    public onerror?: (error: Error) => void;
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    public onclose?: () => void;
    public send = vi.fn(async () => undefined);
    public close = vi.fn(async () => undefined);
    public start = vi.fn(async () => undefined);
    public handleRequest = vi.fn(async (_req: any) => {
      if (!this.sessionId) {
        const requestedSessionId =
          _req?.headers?.['mcp-session-id'] && typeof _req.headers['mcp-session-id'] === 'string'
            ? _req.headers['mcp-session-id']
            : null;
        this.sessionId = requestedSessionId ?? this.sessionIdGenerator();
      }
    });

    constructor(options: { sessionIdGenerator: () => string; enableJsonResponse?: boolean }) {
      this.options = options;
      if (mocks.failNextConstruct) {
        throw new Error('inner transport construction failed');
      }
      mocks.innerTransports.push(this);
      mocks.innerTransportOptions.push(options);
    }

    private sessionIdGenerator(): string {
      return this.options.sessionIdGenerator();
    }
  },
}));

import { MultiplexedStreamableHttpTransport } from '@server/transport/MultiplexedStreamableHttpTransport';

vi.mock('@src/constants', () => ({
  HTTP_CAPACITY_RETRY_AFTER_MS: 1_000,
  MCP_HTTP_JSON_RESPONSE: false,
}));

const ORIGINAL_ENV = { ...process.env };

function createReq(method: string, sessionId?: string) {
  return {
    method,
    headers: sessionId ? { 'mcp-session-id': sessionId } : {},
  } as any;
}

function createRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as any;
}

describe('MultiplexedStreamableHttpTransport', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MCP_HTTP_MAX_INFLIGHT;
    delete process.env.MCP_HTTP_MAX_SSE_INFLIGHT;
    mocks.innerTransports.length = 0;
    mocks.innerTransportOptions.length = 0;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('rejects repeated start calls', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();

    await expect(transport.start()).rejects.toThrow(
      'MultiplexedStreamableHttpTransport already started',
    );
  });

  it('creates a new inner transport for new HTTP sessions and reuses existing ones by header', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    await transport.handleRequest(createReq('POST'), createRes(), {});
    expect(mocks.innerTransports).toHaveLength(2);

    const existing = mocks.innerTransports[0];
    const existingSessionId = existing.sessionId;
    await transport.handleRequest(createReq('POST', existingSessionId), createRes(), {});
    expect(existing.handleRequest).toHaveBeenCalledTimes(2);
  });

  it('bounds initialized sessions before allocating another inner transport', async () => {
    const onSessionOpened = vi.fn(async () => undefined);
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      capacityRetryAfterMs: 2_500,
      onSessionOpened,
    });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const admitted = mocks.innerTransports[0];
    expect(onSessionOpened).toHaveBeenCalledWith(admitted.sessionId);
    expect(transport.getStats()).toEqual({
      sessions: 1,
      sessionLimit: 1,
      sessionIdleTtlMs: null,
      inFlight: 0,
      pendingAdmissions: 0,
    });

    const overloaded = createRes();
    await transport.handleRequest(createReq('POST'), overloaded, {});

    expect(mocks.innerTransports).toHaveLength(1);
    expect(overloaded.writeHead).toHaveBeenCalledWith(503, {
      'Content-Type': 'application/json',
      'Retry-After': '3',
    });
    expect(JSON.parse(overloaded.end.mock.calls[0]![0])).toMatchObject({
      error: {
        code: -32001,
        data: {
          code: 'MCP_SESSION_CAPACITY',
          retryAfterMs: 2_500,
          sessionCount: 1,
          sessionLimit: 1,
        },
      },
    });

    admitted.onclose?.();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    expect(mocks.innerTransports).toHaveLength(2);
  });

  it('reserves capacity while asynchronous session admission is pending', async () => {
    let releaseAdmission!: () => void;
    const admissionGate = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    const onSessionOpened = vi.fn(async () => await admissionGate);
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      onSessionOpened,
    });
    await transport.start();

    const first = transport.handleRequest(createReq('POST'), createRes(), {});
    await vi.waitFor(() => {
      expect(onSessionOpened).toHaveBeenCalledOnce();
      expect(transport.getStats().pendingAdmissions).toBe(1);
    });

    const overloaded = createRes();
    await transport.handleRequest(createReq('POST'), overloaded, {});
    expect(overloaded.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(JSON.parse(overloaded.end.mock.calls[0]![0])).toMatchObject({
      error: {
        data: {
          code: 'MCP_SESSION_CAPACITY',
          sessionCount: 1,
          pendingAdmissions: 1,
        },
      },
    });
    expect(mocks.innerTransports).toHaveLength(0);

    releaseAdmission();
    await first;
    expect(mocks.innerTransports).toHaveLength(1);
    expect(transport.getStats()).toMatchObject({ sessions: 1, pendingAdmissions: 0 });
  });

  it('fails initialization before the SDK responds when fleet admission is rejected', async () => {
    const onSessionOpened = vi.fn(async () => {
      throw Object.assign(new Error('worker lease capacity reached'), {
        code: 'BROWSER_FLEET_LEASE_CAPACITY',
        retryAfterMs: 2_500,
      });
    });
    const transport = new MultiplexedStreamableHttpTransport({ maxSessions: 1, onSessionOpened });
    await transport.start();

    const response = createRes();
    await transport.handleRequest(createReq('POST'), response, {});

    expect(mocks.innerTransports).toHaveLength(0);
    expect(response.writeHead).toHaveBeenCalledWith(503, {
      'Content-Type': 'application/json',
      'Retry-After': '3',
    });
    expect(JSON.parse(response.end.mock.calls[0]![0])).toMatchObject({
      error: {
        code: -32002,
        data: {
          code: 'BROWSER_FLEET_LEASE_CAPACITY',
          retryAfterMs: 2_500,
        },
      },
    });
    expect(transport.getStats()).toMatchObject({ sessions: 0, pendingAdmissions: 0 });
  });

  it('expires idle sessions and admits replacement transports', async () => {
    let now = 0;
    const onSessionClosed = vi.fn();
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      sessionIdleTtlMs: 100,
      now: () => now,
      onSessionClosed,
    });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const expired = mocks.innerTransports[0];

    now = 101;
    await transport.handleRequest(createReq('POST'), createRes(), {});

    expect(expired.close).toHaveBeenCalledOnce();
    expect(onSessionClosed).toHaveBeenCalledWith(expired.sessionId);
    expect(mocks.innerTransports).toHaveLength(2);
    expect(transport.getStats()).toMatchObject({ sessions: 1, sessionIdleTtlMs: 100 });

    now = 202;
    const expiredResponse = createRes();
    const currentSession = mocks.innerTransports[1];
    await transport.handleRequest(createReq('POST', currentSession.sessionId), expiredResponse, {});
    expect(expiredResponse.writeHead).toHaveBeenCalledWith(404, {
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(expiredResponse.end.mock.calls[0]![0])).toMatchObject({
      error: { data: { code: 'MCP_SESSION_EXPIRED' } },
    });
  });

  it('does not evict a session while one of its requests is in flight', async () => {
    let now = 0;
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      sessionIdleTtlMs: 100,
      now: () => now,
    });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.handleRequest.mockImplementationOnce(async () => await gate);

    now = 90;
    const active = transport.handleRequest(createReq('POST', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(transport.getStats().inFlight).toBe(1));
    now = 200;
    const overloaded = createRes();
    await transport.handleRequest(createReq('POST'), overloaded, {});

    expect(overloaded.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(session.close).not.toHaveBeenCalled();
    release();
    await active;
  });

  it('rejects a session request once its in-flight capacity is reached', async () => {
    const transport = new MultiplexedStreamableHttpTransport({ maxInFlight: 2 });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.handleRequest.mockImplementation(async () => await gate);

    const first = transport.handleRequest(createReq('POST', session.sessionId), createRes(), {});
    const second = transport.handleRequest(createReq('POST', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(transport.getStats().inFlight).toBe(2));

    const overloaded = createRes();
    // The in-flight cap rejects before any await; without the cap the promise
    // would hang on the gate, so race it to fail fast on a regression.
    const third = transport.handleRequest(createReq('POST', session.sessionId), overloaded, {});
    const outcome = await Promise.race([
      third.then(() => 'resolved'),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 500)),
    ]);

    expect(outcome).toBe('resolved');
    expect(overloaded.writeHead).toHaveBeenCalledWith(503, {
      'Content-Type': 'application/json',
      'Retry-After': '1',
    });
    expect(JSON.parse(overloaded.end.mock.calls[0]![0])).toMatchObject({
      error: {
        code: -32001,
        data: {
          code: 'MCP_SESSION_INFLIGHT_CAPACITY',
          inFlight: 2,
          inFlightLimit: 2,
        },
      },
    });

    release();
    await Promise.allSettled([first, second, third]);
  });

  it('resolves the default in-flight cap from env when each transport is constructed', async () => {
    process.env.MCP_HTTP_MAX_INFLIGHT = '1';
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.handleRequest.mockImplementation(async () => await gate);

    const active = transport.handleRequest(createReq('POST', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(transport.getStats().inFlight).toBe(1));

    const overloaded = createRes();
    await transport.handleRequest(createReq('POST', session.sessionId), overloaded, {});
    expect(JSON.parse(overloaded.end.mock.calls[0]![0])).toMatchObject({
      error: { data: { code: 'MCP_SESSION_INFLIGHT_CAPACITY', inFlightLimit: 1 } },
    });

    release();
    await active;
  });

  it('does not count SSE GET streams against POST in-flight capacity', async () => {
    const transport = new MultiplexedStreamableHttpTransport({ maxInFlight: 1 });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.handleRequest.mockImplementationOnce(async () => await gate);

    const sse = transport.handleRequest(createReq('GET', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(session.handleRequest).toHaveBeenCalledTimes(2));

    // A hanging SSE GET must not consume POST in-flight capacity.
    expect(transport.getStats().inFlight).toBe(0);

    // A POST is still admitted while an SSE GET is open.
    const postRes = createRes();
    await transport.handleRequest(createReq('POST', session.sessionId), postRes, {});
    expect(postRes.writeHead).not.toHaveBeenCalledWith(503, expect.any(Object));

    release();
    await sse;
  });

  it('bounds concurrent SSE GET streams with a separate small cap', async () => {
    const transport = new MultiplexedStreamableHttpTransport({ maxSseInFlight: 2 });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.handleRequest.mockImplementation(async () => await gate);

    const first = transport.handleRequest(createReq('GET', session.sessionId), createRes(), {});
    const second = transport.handleRequest(createReq('GET', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(session.handleRequest).toHaveBeenCalledTimes(3));

    const overloaded = createRes();
    const third = transport.handleRequest(createReq('GET', session.sessionId), overloaded, {});
    const outcome = await Promise.race([
      third.then(() => 'resolved'),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 500)),
    ]);

    expect(outcome).toBe('resolved');
    expect(overloaded.writeHead).toHaveBeenCalledWith(503, {
      'Content-Type': 'application/json',
      'Retry-After': '1',
    });

    release();
    await Promise.allSettled([first, second, third]);
  });

  it('does not evict a session while an SSE GET stream is open', async () => {
    let now = 0;
    const onSessionClosed = vi.fn();
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      sessionIdleTtlMs: 100,
      now: () => now,
      onSessionClosed,
    });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.handleRequest.mockImplementationOnce(async () => await gate);

    const sse = transport.handleRequest(createReq('GET', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(session.handleRequest).toHaveBeenCalledTimes(2));

    now = 200;
    // With the SSE GET open, the session is not idle even though inFlight is 0.
    const probe = createRes();
    await transport.handleRequest(createReq('POST', session.sessionId), probe, {});
    expect(probe.writeHead).not.toHaveBeenCalledWith(404, expect.any(Object));
    expect(session.close).not.toHaveBeenCalled();

    release();
    await sse;
  });

  it('does not evict an SSE-open session through the admission sweeper', async () => {
    let now = 0;
    const onSessionClosed = vi.fn();
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      sessionIdleTtlMs: 100,
      now: () => now,
      onSessionClosed,
    });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.handleRequest.mockImplementationOnce(async () => await gate);

    const sse = transport.handleRequest(createReq('GET', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(session.handleRequest).toHaveBeenCalledTimes(2));

    // Advance past the idle TTL, then force the admission-pressure sweeper
    // (maxSessions:1) by registering a fresh session. The open SSE GET must
    // keep the first session alive even though its POST inFlight is 0.
    now = 200;
    const overloaded = createRes();
    await transport.handleRequest(createReq('POST'), overloaded, {});
    expect(overloaded.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(session.close).not.toHaveBeenCalled();

    release();
    await sse;
  });

  it('routes same client request ids from different sessions back to the correct inner transport', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    const seenMessages: any[] = [];

    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onmessage = (message) => {
      seenMessages.push(message);
    };

    await transport.handleRequest(createReq('POST'), createRes(), {});
    await transport.handleRequest(createReq('POST'), createRes(), {});

    const sessionA = mocks.innerTransports[0];
    const sessionB = mocks.innerTransports[1];

    const requestA: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };
    const requestB: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    sessionA.onmessage?.(requestA, {});
    sessionB.onmessage?.(requestB, {});

    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[0]!.id).not.toBe(seenMessages[1]!.id);
    expect(seenMessages[0]!.params._meta.sessionId).toBe(sessionA.sessionId);
    expect(seenMessages[1]!.params._meta.sessionId).toBe(sessionB.sessionId);

    const responseA: JSONRPCResultResponse = {
      jsonrpc: '2.0',
      id: seenMessages[0]!.id,
      result: { ok: true },
    };
    const responseB: JSONRPCResultResponse = {
      jsonrpc: '2.0',
      id: seenMessages[1]!.id,
      result: { ok: true },
    };

    await transport.send(responseA);
    await transport.send(responseB);

    expect(sessionA.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        id: 1,
        result: { ok: true },
      },
      undefined,
    );
    expect(sessionB.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        id: 1,
        result: { ok: true },
      },
      undefined,
    );
  });

  it('preserves client request metadata while enforcing the transport session id', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    const seenMessages: any[] = [];
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onmessage = (message) => seenMessages.push(message);

    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    session.onmessage?.({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'search_tools',
        arguments: {},
        _meta: { progressToken: 'p1', sessionId: 'spoofed' },
      },
    });

    expect(seenMessages[0]!.params._meta).toEqual({
      progressToken: 'p1',
      sessionId: session.sessionId,
    });
  });

  it('rewrites cancellation notifications back onto internal request ids', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    const seenMessages: any[] = [];

    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onmessage = (message) => {
      seenMessages.push(message);
    };

    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    session.onmessage?.({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
    } satisfies JSONRPCRequest);

    session.onmessage?.({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: {
        requestId: 9,
      },
    });

    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[0]!.id).toBeTypeOf('string');
    expect(seenMessages[1]).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: {
        requestId: seenMessages[0]!.id,
      },
    });
  });

  it('returns a json-rpc 404 for unknown session headers', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    const res = createRes();

    await transport.handleRequest(createReq('POST', 'missing-session'), res, {});

    expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unknown MCP session: missing-session',
        },
        id: null,
      }),
    );
  });

  it('broadcasts notifications and rejects ambiguous outbound requests', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const [sessionA, sessionB] = mocks.innerTransports;

    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/message',
    });

    expect(sessionA.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'notifications/message',
      },
      undefined,
    );
    expect(sessionB.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'notifications/message',
      },
      undefined,
    );

    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 'server-request',
        method: 'tools/list',
      }),
    ).rejects.toThrow('Ambiguous HTTP session for outbound request/response routing.');
  });

  it('skips idle sessions when broadcasting notifications', async () => {
    let now = 0;
    const transport = new MultiplexedStreamableHttpTransport({ now: () => now });
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const [sessionA, sessionB] = mocks.innerTransports;

    // Touch only session A after the default 5-minute broadcast idle TTL, leaving
    // session B idle past the threshold.
    now = 400_000;
    await transport.handleRequest(createReq('POST', sessionA.sessionId), createRes(), {});

    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/message',
    });

    expect(sessionA.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'notifications/message',
      },
      undefined,
    );
    expect(sessionB.send).not.toHaveBeenCalled();
    // Idle sessions are skipped, not evicted.
    expect(transport.getStats().sessions).toBe(2);
  });

  it('keeps a long-lived open SSE session eligible for broadcasts', async () => {
    let now = 0;
    const transport = new MultiplexedStreamableHttpTransport({ now: () => now });
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0]!;
    let closeSse!: () => void;
    const sseClosed = new Promise<void>((resolve) => {
      closeSse = resolve;
    });
    session.handleRequest.mockImplementationOnce(async () => await sseClosed);

    const openSse = transport.handleRequest(createReq('GET', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(session.handleRequest).toHaveBeenCalledTimes(2));

    now = 400_000;
    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/message',
    });

    expect(session.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'notifications/message',
      },
      undefined,
    );

    closeSse();
    await openSse;
  });

  it('broadcasts to idle sessions when broadcastIdleTtlMs is Infinity', async () => {
    let now = 0;
    const transport = new MultiplexedStreamableHttpTransport({
      now: () => now,
      broadcastIdleTtlMs: Number.POSITIVE_INFINITY,
    });
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const [sessionA, sessionB] = mocks.innerTransports;

    now = 10_000_000;
    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/message',
    });

    expect(sessionA.send).toHaveBeenCalled();
    expect(sessionB.send).toHaveBeenCalled();
  });

  it('releases the admission claim when inner transport construction fails', async () => {
    const onSessionClosed = vi.fn();
    const onSessionOpened = vi.fn(async () => undefined);
    const transport = new MultiplexedStreamableHttpTransport({ onSessionOpened, onSessionClosed });
    await transport.start();

    mocks.failNextConstruct = true;
    try {
      await expect(transport.handleRequest(createReq('POST'), createRes(), {})).rejects.toThrow(
        'inner transport construction failed',
      );
    } finally {
      mocks.failNextConstruct = false;
    }

    // The admission hook claimed a fleet lease (admissionClaimed=true), so the
    // failure must still release it — otherwise the lease leaks.
    expect(onSessionOpened).toHaveBeenCalledOnce();
    expect(onSessionClosed).toHaveBeenCalledWith(expect.any(String));
    expect(transport.getStats().pendingAdmissions).toBe(0);
  });

  it('routes by relatedRequestId and clears session state on close', async () => {
    const onSessionClosed = vi.fn();
    const transport = new MultiplexedStreamableHttpTransport({ onSessionClosed });
    const onclose = vi.fn();
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onclose = onclose;
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    session.onmessage?.({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
    } satisfies JSONRPCRequest);

    const internalId = `http:${session.sessionId}:1`;
    await transport.send(
      {
        jsonrpc: '2.0',
        method: 'notifications/progress',
      },
      { relatedRequestId: internalId },
    );

    expect(session.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'notifications/progress',
      },
      { relatedRequestId: 5 },
    );

    session.onclose?.();
    expect(onSessionClosed).toHaveBeenCalledWith(session.sessionId);
    await transport.close();
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('constructs inner transports with enableJsonResponse disabled by default', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});

    expect(mocks.innerTransportOptions[0]).toMatchObject({ enableJsonResponse: false });
  });

  it('enables JSON responses on inner transports when MCP_HTTP_JSON_RESPONSE is set', async () => {
    const constantsMod = await import('@src/constants');
    (constantsMod as { MCP_HTTP_JSON_RESPONSE: boolean }).MCP_HTTP_JSON_RESPONSE = true;
    try {
      const transport = new MultiplexedStreamableHttpTransport();
      await transport.start();

      await transport.handleRequest(createReq('POST'), createRes(), {});

      expect(mocks.innerTransportOptions[0]).toMatchObject({ enableJsonResponse: true });
    } finally {
      (constantsMod as { MCP_HTTP_JSON_RESPONSE: boolean }).MCP_HTTP_JSON_RESPONSE = false;
    }
  });
});
