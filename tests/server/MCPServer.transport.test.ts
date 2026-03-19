import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const httpServers: any[] = [];
  const httpTransports: any[] = [];
  const logger = {
    success: vi.fn(),
    warn: vi.fn(),
  };

  function createMockHttpServer(handler: (req: any, res: any) => void) {
    const listeners = new Map<string, Array<(...args: any[]) => void>>();
    const server = {
      __handler: handler,
      __listeners: listeners,
      requestTimeout: 0,
      headersTimeout: 0,
      keepAliveTimeout: 0,
      listen: vi.fn((_: number, __: string, cb?: () => void) => {
        cb?.();
      }),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => {
        const current = listeners.get(event) ?? [];
        current.push(cb);
        listeners.set(event, current);
        return server;
      }),
      emit(event: string, ...args: any[]) {
        for (const cb of listeners.get(event) ?? []) {
          cb(...args);
        }
      },
      close: vi.fn((cb?: () => void) => {
        cb?.();
      }),
    };
    return server;
  }

  return {
    httpServers,
    httpTransports,
    createServer: vi.fn((handler: (req: any, res: any) => void) => {
      const server = createMockHttpServer(handler);
      httpServers.push(server);
      return server;
    }),
    randomUUID: vi.fn(() => 'uuid-123'),
    checkOrigin: vi.fn(() => true),
    checkAuth: vi.fn(() => true),
    checkRateLimit: vi.fn(() => true),
    readBodyWithLimit: vi.fn(async () => '{"ok":true}'),
    logger,
    stdioConnects: [] as any[],
  };
});

vi.mock('node:http', () => ({
  createServer: mocks.createServer,
}));

vi.mock('node:crypto', () => ({
  randomUUID: mocks.randomUUID,
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class MockStdioServerTransport {
    constructor() {
      mocks.stdioConnects.push(this);
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class MockStreamableHTTPServerTransport {
    public options: Record<string, unknown>;
    public handleRequest = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.httpTransports.push(this);
    }
  },
}));

vi.mock('@server/http/HttpMiddleware', () => ({
  checkOrigin: mocks.checkOrigin,
  checkAuth: mocks.checkAuth,
  checkRateLimit: mocks.checkRateLimit,
  readBodyWithLimit: mocks.readBodyWithLimit,
}));

vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@src/constants', () => ({
  MCP_HTTP_REQUEST_TIMEOUT_MS: 1_000,
  MCP_HTTP_HEADERS_TIMEOUT_MS: 2_000,
  MCP_HTTP_KEEPALIVE_TIMEOUT_MS: 3_000,
  MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS: 4_000,
}));

import { closeServer, startHttpTransport, startStdioTransport } from '@server/MCPServer.transport';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    server: {
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    },
    tokenBudget: {
      getStats: vi.fn(() => ({
        usagePercentage: 12,
        currentUsage: 120,
        maxTokens: 1_000,
      })),
    },
    detailedData: {
      shutdown: vi.fn(),
    },
    enabledDomains: new Set(['browser']),
    selectedTools: [{ name: 'browser_launch' }],
    activatedToolNames: new Set(['network_enable']),
    baseTier: 'workflow',
    domainTtlEntries: new Map(),
    httpSockets: new Set(),
    ...overrides,
  } as any;
}

function createRes() {
  const res: Record<string, unknown> = {
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead: vi.fn((status: number, headers: Record<string, string>) => {
      res.status = status;
      res.headers = headers;
      return res;
    }),
    end: vi.fn((body?: string) => {
      res.body = body;
      return res;
    }),
  };
  return res as any;
}

describe('MCPServer.transport', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MCP_PORT;
    delete process.env.MCP_HOST;
    delete process.env.MCP_HEALTH_VERBOSE;
    mocks.httpServers.length = 0;
    mocks.httpTransports.length = 0;
    mocks.stdioConnects.length = 0;
    vi.clearAllMocks();
    mocks.checkOrigin.mockReturnValue(true);
    mocks.checkAuth.mockReturnValue(true);
    mocks.checkRateLimit.mockReturnValue(true);
    mocks.readBodyWithLimit.mockResolvedValue('{"ok":true}');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  it('starts stdio transport and connects the MCP server', async () => {
    const ctx = createCtx();

    await startStdioTransport(ctx);

    expect(ctx.server.connect).toHaveBeenCalledTimes(1);
    expect(mocks.stdioConnects).toHaveLength(1);
    expect(mocks.logger.success).toHaveBeenCalledWith('MCP stdio server started');
  });

  it('registers stdin end/close and stdout error listeners for zombie prevention', async () => {
    const stdinOnSpy = vi.spyOn(process.stdin, 'on').mockReturnValue(process.stdin);
    const stdoutOnSpy = vi.spyOn(process.stdout, 'on').mockReturnValue(process.stdout);
    const ctx = createCtx();

    await startStdioTransport(ctx);

    const stdinEvents = stdinOnSpy.mock.calls.map(([event]) => event);
    expect(stdinEvents).toContain('end');
    expect(stdinEvents).toContain('close');

    const stdoutEvents = stdoutOnSpy.mock.calls.map(([event]) => event);
    expect(stdoutEvents).toContain('error');

    stdinOnSpy.mockRestore();
    stdoutOnSpy.mockRestore();
  });

  it('starts HTTP transport, configures timeouts, and tracks sockets', async () => {
    process.env.MCP_PORT = '4321';
    process.env.MCP_HOST = '0.0.0.0';
    const ctx = createCtx();

    await startHttpTransport(ctx);

    const server = mocks.httpServers[0];
    const transport = mocks.httpTransports[0];

    expect(ctx.server.connect).toHaveBeenCalledWith(transport);
    expect(server.listen).toHaveBeenCalledWith(4321, '0.0.0.0', expect.any(Function));
    expect(server.requestTimeout).toBe(1_000);
    expect(server.headersTimeout).toBe(2_000);
    expect(server.keepAliveTimeout).toBe(3_000);

    const socket = {
      destroy: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'close') {
          socket.__close = cb;
        }
      }),
      __close: undefined as undefined | (() => void),
    };

    server.emit('connection', socket);
    expect(ctx.httpSockets.has(socket)).toBe(true);
    socket.__close?.();
    expect(ctx.httpSockets.has(socket)).toBe(false);

    const sessionId = transport.options.sessionIdGenerator as () => string;
    expect(sessionId()).toBe('uuid-123');
    expect(mocks.logger.success).toHaveBeenCalledWith(
      'MCP Streamable HTTP server listening on http://0.0.0.0:4321/mcp'
    );
  });

  it('serves /health without invoking auth middleware and includes verbose details when enabled', async () => {
    process.env.MCP_HEALTH_VERBOSE = 'true';
    const ctx = createCtx();
    await startHttpTransport(ctx);

    const server = mocks.httpServers[0];
    const req = { url: '/health', method: 'GET' };
    const res = createRes();

    server.__handler(req, res);

    expect(mocks.checkOrigin).not.toHaveBeenCalled();
    expect(mocks.checkAuth).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      tier: 'workflow',
      baseTier: 'workflow',
      enabledDomains: ['browser'],
      registeredTools: 1,
      activatedTools: 1,
      tokenBudget: {
        usagePercentage: 12,
        currentUsage: 120,
        maxTokens: 1_000,
      },
    });
  });

  it('serves /health correctly when baseTier is restricted', async () => {
    process.env.MCP_HEALTH_VERBOSE = 'true';
    const ctx = createCtx({ baseTier: 'restricted' });
    await startHttpTransport(ctx);

    const server = mocks.httpServers[0];
    const req = { url: '/health', method: 'GET' };
    const res = createRes();

    server.__handler(req, res);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.baseTier).toBe('restricted');
    expect(body.tier).toBe('restricted');
  });

  it('returns 404 for non-MCP paths', async () => {
    const ctx = createCtx();
    await startHttpTransport(ctx);

    const server = mocks.httpServers[0];
    const res = createRes();

    server.__handler({ url: '/other', method: 'GET' }, res);

    expect(res.status).toBe(404);
    expect(res.body).toBe('Not Found – use POST /mcp or GET /health');
  });

  it('stops processing when origin, auth, or rate limit checks fail', async () => {
    const ctx = createCtx();
    await startHttpTransport(ctx);
    const server = mocks.httpServers[0];
    const res = createRes();

    mocks.checkOrigin.mockReturnValueOnce(false);
    server.__handler({ url: '/mcp', method: 'GET' }, res);
    expect(mocks.checkAuth).not.toHaveBeenCalled();

    mocks.checkOrigin.mockReturnValue(true);
    mocks.checkAuth.mockReturnValueOnce(false);
    server.__handler({ url: '/mcp', method: 'GET' }, createRes());
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();

    mocks.checkAuth.mockReturnValue(true);
    mocks.checkRateLimit.mockReturnValueOnce(false);
    server.__handler({ url: '/mcp', method: 'GET' }, createRes());
    expect(mocks.httpTransports[0].handleRequest).not.toHaveBeenCalled();
  });

  it('passes GET and DELETE MCP requests directly to the HTTP transport', async () => {
    const ctx = createCtx();
    await startHttpTransport(ctx);
    const server = mocks.httpServers[0];
    const transport = mocks.httpTransports[0];

    const getReq = { url: '/mcp', method: 'GET' };
    const deleteReq = { url: '/mcp', method: 'DELETE' };
    server.__handler(getReq, createRes());
    server.__handler(deleteReq, createRes());

    expect(transport.handleRequest).toHaveBeenNthCalledWith(1, getReq, expect.any(Object));
    expect(transport.handleRequest).toHaveBeenNthCalledWith(2, deleteReq, expect.any(Object));
  });

  it('reads POST bodies before handing requests to the HTTP transport', async () => {
    const ctx = createCtx();
    await startHttpTransport(ctx);
    const server = mocks.httpServers[0];
    const transport = mocks.httpTransports[0];
    const req = { url: '/mcp', method: 'POST' };
    const res = createRes();

    server.__handler(req, res);
    await Promise.resolve();

    expect(mocks.readBodyWithLimit).toHaveBeenCalledWith(req, res);
    expect(transport.handleRequest).toHaveBeenCalledWith(req, res, '{"ok":true}');
  });

  it('returns 405 for unsupported HTTP methods', async () => {
    const ctx = createCtx();
    await startHttpTransport(ctx);
    const server = mocks.httpServers[0];
    const res = createRes();

    server.__handler({ url: '/mcp', method: 'PUT' }, res);

    expect(res.status).toBe(405);
    expect(res.body).toBe('Method Not Allowed');
  });

  it('closes the HTTP server, clears timers, disposes domain instances, and closes the MCP server', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const timerA = setTimeout(() => undefined, 10);
    const timerB = setTimeout(() => undefined, 10);
    const consoleMonitor = { disable: vi.fn(async () => undefined) };
    const runtimeInspector = {
      close: vi.fn(async () => {
        throw new Error('runtime close failed');
      }),
    };
    const debuggerManager = { close: vi.fn(async () => undefined) };
    const scriptManager = { close: vi.fn(async () => undefined) };
    const transformHandlers = { close: vi.fn(async () => undefined) };
    const collector = { close: vi.fn(async () => undefined) };
    const socket = { destroy: vi.fn() };
    const httpServer = {
      close: vi.fn((cb?: () => void) => {
        cb?.();
      }),
    };
    const ctx = createCtx({
      domainTtlEntries: new Map([
        ['browser', { timer: timerA }],
        ['network', { timer: timerB }],
      ]),
      httpServer,
      httpSockets: new Set([socket]),
      consoleMonitor,
      runtimeInspector,
      debuggerManager,
      scriptManager,
      transformHandlers,
      collector,
    });

    await closeServer(ctx);

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerA);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerB);
    expect(ctx.domainTtlEntries.size).toBe(0);
    expect(ctx.detailedData.shutdown).toHaveBeenCalledTimes(1);
    expect(httpServer.close).toHaveBeenCalledTimes(1);
    expect(ctx.httpSockets.size).toBe(0);
    expect(consoleMonitor.disable).toHaveBeenCalledTimes(1);
    expect(runtimeInspector.close).toHaveBeenCalledTimes(1);
    expect(debuggerManager.close).toHaveBeenCalledTimes(1);
    expect(scriptManager.close).toHaveBeenCalledTimes(1);
    expect(transformHandlers.close).toHaveBeenCalledTimes(1);
    expect(collector.close).toHaveBeenCalledTimes(1);
    expect(ctx.consoleMonitor).toBeUndefined();
    expect(ctx.runtimeInspector).toBeUndefined();
    expect(ctx.debuggerManager).toBeUndefined();
    expect(ctx.scriptManager).toBeUndefined();
    expect(ctx.collector).toBeUndefined();
    expect(ctx.httpServer).toBeUndefined();
    expect(ctx.server.close).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'runtimeInspector cleanup failed:',
      expect.any(Error)
    );
    expect(mocks.logger.success).toHaveBeenCalledWith('MCP server closed');
  });
});
