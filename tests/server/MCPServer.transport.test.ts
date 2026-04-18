import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const httpServers: any[] = [];
  const httpTransports: any[] = [];
  const logger = {
    success: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
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

  // Mutable reference so individual tests can replace the send implementation
  const stdioSendMock = vi.fn(() => Promise.resolve());

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
    stdioSendMock,
  };
});

vi.mock('node:http', () => ({
  createServer: mocks.createServer,
}));

vi.mock('node:crypto', () => ({
  randomUUID: mocks.randomUUID,
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  // StdioServerTransport uses `onclose` as a callback property, not addEventListener.
  // eslint-disable-next-line unicorn/prefer-add-event-listener
  StdioServerTransport: function MockStdioServerTransport(this: {
    onclose?: () => void;
    send?: (...args: any[]) => any;
  }) {
    mocks.stdioConnects.push(this);
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    this.onclose = undefined;
    this.send = (...args: any[]) => (mocks.stdioSendMock as any)(...args);
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
    // Reset mock implementations without clearing call history
    mocks.logger.success.mockRestore();
    mocks.logger.warn.mockRestore();
    mocks.logger.info.mockRestore();
    mocks.logger.error.mockRestore();
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

  it('sets transport.onclose to trigger cleanup on transport close', async () => {
    const ctx = createCtx();
    await startStdioTransport(ctx);
    const transport = mocks.stdioConnects[0];
    expect(typeof transport.onclose).toBe('function');
  });

  it('handles transport.onclose and closeServer failures gracefully', async () => {
    const ctx = createCtx();
    // Make closeServer's internal steps fail so the outer catch in onclose fires
    ctx.server.close = vi.fn(async () => {
      throw new Error('close error');
    });
    await startStdioTransport(ctx);
    const transport = mocks.stdioConnects[0];
    mocks.logger.error.mockClear();
    mocks.logger.warn.mockClear();
    transport.onclose?.();
    await new Promise((r) => setTimeout(r, 0));
    // closeServer's own catch logs 'MCP server close failed:' — this is correct
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'MCP server close failed:',
      expect.objectContaining({ message: 'close error' }),
    );
    expect(mocks.logger.success).toHaveBeenCalledWith('MCP server closed');
  });

  it('handles transport.onclose idempotently', async () => {
    const ctx = createCtx();
    await startStdioTransport(ctx);
    const transport = mocks.stdioConnects[0];
    mocks.logger.info.mockClear();
    transport.onclose?.();
    transport.onclose?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.logger.info).toHaveBeenCalledWith('stdio transport closed — running cleanup...');
    expect(mocks.logger.info).toHaveBeenCalledTimes(1);
    expect(ctx.server.close).toHaveBeenCalledTimes(1);
  });

  it('does not re-enter cleanup when transport.onclose fires during server.close()', async () => {
    const ctx = createCtx();
    await startStdioTransport(ctx);
    const transport = mocks.stdioConnects[0];
    ctx.server.close = vi.fn(async () => {
      transport.onclose?.();
    });

    await closeServer(ctx);

    expect(ctx.server.close).toHaveBeenCalledTimes(1);
    expect(mocks.logger.success).toHaveBeenCalledWith('MCP server closed');
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
      'MCP Streamable HTTP server listening on http://0.0.0.0:4321/mcp',
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

  it('serves /health correctly when baseTier is search', async () => {
    process.env.MCP_HEALTH_VERBOSE = 'true';
    const ctx = createCtx({ baseTier: 'search' });
    await startHttpTransport(ctx);

    const server = mocks.httpServers[0];
    const req = { url: '/health', method: 'GET' };
    const res = createRes();

    server.__handler(req, res);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.baseTier).toBe('search');
    expect(body.tier).toBe('search');
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
      expect.any(Error),
    );
    expect(mocks.logger.success).toHaveBeenCalledWith('MCP server closed');
  });

  it('registers stdin end/close listeners after connect (zombie prevention)', async () => {
    const stdinOnSpy = vi.spyOn(process.stdin, 'on').mockReturnValue(process.stdin);
    await startStdioTransport(createCtx());
    const events = stdinOnSpy.mock.calls.map(([ev]) => ev);
    expect(events).toContain('end');
    expect(events).toContain('close');
    stdinOnSpy.mockRestore();
  });

  it('handles stdin EOF gracefully — cleanup + exit', async () => {
    const stdinOnSpy = vi.spyOn(process.stdin, 'on').mockReturnValue(process.stdin);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const ctx = createCtx();
    await startStdioTransport(ctx);

    const handleStdinEnd = stdinOnSpy.mock.calls.find(([ev]) => ev === 'end')?.[1] as () => void;
    handleStdinEnd();
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.server.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    stdinOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('handles stdin EOF idempotently — shuttingDown flag prevents double-exit', async () => {
    const stdinOnSpy = vi.spyOn(process.stdin, 'on').mockReturnValue(process.stdin);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const ctx = createCtx();
    await startStdioTransport(ctx);

    const handleStdinEnd = stdinOnSpy.mock.calls.find(([ev]) => ev === 'end')?.[1] as () => void;
    handleStdinEnd(); // first call
    handleStdinEnd(); // second call — should be no-op
    await new Promise((r) => setTimeout(r, 0));
    // server.close called once (second call returns early via shuttingDown guard)
    expect(ctx.server.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);

    stdinOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('wraps transport.send with a timeout guard', async () => {
    const ctx = createCtx();
    await startStdioTransport(ctx);
    const transport = mocks.stdioConnects[0];
    expect(typeof transport.send).toBe('function');
  });

  it('transport.send timeout guard resolves early when origSend hangs', async () => {
    vi.useFakeTimers();

    // Replace send mock with one that hangs indefinitely
    mocks.stdioSendMock.mockImplementationOnce(
      () => new Promise<void>(() => {}), // never resolves
    );

    const ctx = createCtx();
    await startStdioTransport(ctx);
    const transport = mocks.stdioConnects[0] as { send?: (...args: any[]) => any };

    // Call the wrapped send — the 500ms timeout should resolve early
    const sendPromise = transport.send!('test-message');
    await vi.advanceTimersByTimeAsync(600);

    await expect(sendPromise).resolves.toBeUndefined();
    // Restore normal behavior for subsequent tests
    mocks.stdioSendMock.mockResolvedValueOnce(undefined);
    vi.useRealTimers();
  });

  it('ignores errors when readBodyWithLimit rejects during POST', async () => {
    const ctx = createCtx();
    await startHttpTransport(ctx);
    const server = mocks.httpServers[0];
    const transport = mocks.httpTransports[0];
    const req = { url: '/mcp', method: 'POST' };
    const res = createRes();

    mocks.readBodyWithLimit.mockRejectedValueOnce(new Error('Body too large'));
    server.__handler(req, res);

    await new Promise((r) => setTimeout(r, 0));
    expect(transport.handleRequest).not.toHaveBeenCalled();
  });

  it('rethrows when server.connect() throws during HTTP transport startup', async () => {
    const ctx = createCtx();
    ctx.server.connect = vi.fn(async () => {
      throw new Error('connect failed');
    });

    await expect(startHttpTransport(ctx)).rejects.toThrow('connect failed');
  });

  it('rethrows when server.connect() throws during stdio transport startup', async () => {
    const ctx = createCtx();
    ctx.server.connect = vi.fn(async () => {
      throw new Error('stdio connect failed');
    });

    await expect(startStdioTransport(ctx)).rejects.toThrow('stdio connect failed');
  });

  it('throws an error if createServer assigns undefined to ctx.httpServer', async () => {
    const originalCreateServer = mocks.createServer.getMockImplementation();
    mocks.createServer.mockImplementationOnce(() => undefined as any);
    const ctx = createCtx();
    await expect(startHttpTransport(ctx)).rejects.toThrow('HTTP server initialization failed');
    if (originalCreateServer) {
      mocks.createServer.mockImplementation(originalCreateServer);
    }
  });

  it('rejects if HTTP server emits error during listen', async () => {
    const originalCreateServer = mocks.createServer.getMockImplementation();
    let errCb: any;
    mocks.createServer.mockImplementationOnce((handler: any) => {
      return {
        __handler: handler,
        __listeners: new Map(),
        requestTimeout: 0,
        headersTimeout: 0,
        keepAliveTimeout: 0,
        listen: vi.fn(),
        on: vi.fn((event: string, cb: any) => {
          if (event === 'error') errCb = cb;
        }),
        emit: vi.fn(),
        close: vi.fn(),
      } as any;
    });

    const ctx = createCtx();
    const p = startHttpTransport(ctx);

    // Wait microtasks so the 'on' handler is registered
    await new Promise((r) => setTimeout(r, 0));
    errCb?.(new Error('listen error'));

    await expect(p).rejects.toThrow('listen error');

    if (originalCreateServer) {
      mocks.createServer.mockImplementation(originalCreateServer);
    }
  });

  it('handles activationController dispose via getDomainInstance', async () => {
    const ctx = createCtx();
    const disposeMock = vi.fn(() => {
      throw new Error('dispose failed');
    });
    ctx.getDomainInstance = vi.fn().mockReturnValue({ dispose: disposeMock });

    await closeServer(ctx);
    expect(disposeMock).toHaveBeenCalled();
  });

  it('returns the existing shutdownPromise when closeServer is re-entered after shutdown starts', async () => {
    const shutdownPromise = Promise.resolve();
    const ctx = createCtx({
      shutdownStarted: true,
      shutdownPromise,
    });

    const result = closeServer(ctx);

    await expect(result).resolves.toBeUndefined();
    expect(ctx.server.close).not.toHaveBeenCalled();
  });

  it('handles activationController dispose directly on ctx', async () => {
    const ctx = createCtx();
    const disposeMock = vi.fn(() => {
      throw new Error('dispose failed');
    });
    ctx.activationController = { dispose: disposeMock };

    await closeServer(ctx);
    expect(disposeMock).toHaveBeenCalled();
  });

  it('closeServer uses ctx.activationController fallback when getDomainInstance is not a function', async () => {
    const ctx = createCtx();
    const disposeMock = vi.fn(() => {
      throw new Error('fallback dispose failed');
    });
    ctx.activationController = { dispose: disposeMock };
    // Remove getDomainInstance to trigger the fallback path
    ctx.getDomainInstance = undefined as any;

    await closeServer(ctx);
    expect(disposeMock).toHaveBeenCalled();
  });

  it('closeServer skips activationController cleanup when dispose is not a function', async () => {
    const ctx = createCtx();
    // activationController without dispose method
    ctx.getDomainInstance = vi.fn().mockReturnValue({});

    await closeServer(ctx);
    // Should complete without throwing
    expect(mocks.logger.warn).not.toHaveBeenCalledWith(
      'activationController cleanup failed:',
      expect.any(Error),
    );
  });

  it('forces socket destruction after MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const ctx = createCtx();
    const socket = { destroy: vi.fn() };
    ctx.httpSockets.add(socket);
    ctx.httpServer = {
      close: vi.fn(),
    };

    const closePromise = closeServer(ctx);
    vi.advanceTimersByTime(5000); // 5000ms > 4000ms timeout

    expect(socket.destroy).toHaveBeenCalled();
    ctx.httpServer.close.mock.calls[0][0](); // manually resolve close
    await closePromise;
  });

  it('handles collector close rejection gracefully', async () => {
    const ctx = createCtx();
    ctx.collector = { close: vi.fn().mockRejectedValue(new Error('failed')) };

    await closeServer(ctx);
    expect(ctx.collector).toBeUndefined();
  });

  it('handles server close rejection gracefully', async () => {
    const ctx = createCtx();
    ctx.server.close.mockRejectedValue(new Error('failed'));

    await closeServer(ctx);
    expect(mocks.logger.warn).toHaveBeenCalledWith('MCP server close failed:', expect.any(Error));
  });
});
