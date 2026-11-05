/**
 * Proves the mcp2 contract guard is genuinely invoked when the modern
 * `/mcp/v2` handler is first constructed — i.e. the barrel is a real
 * production dependency of the HTTP entry, not just a test-only pin.
 *
 * The lazy handler init awaits four dynamic import()s, so instead of sleeping
 * we await the guard's own resolution signal (Promise.withResolvers): the
 * test completes exactly when the contract check has run, deterministically.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SdkServer from '@modelcontextprotocol/server';

const mocks = vi.hoisted(() => {
  const httpServers: Array<{
    requestHandlerForTest: (req: unknown, res: unknown) => void;
  }> = [];
  return {
    httpServers,
    assertMcp2Contract: vi.fn(),
    createMcpHandler: vi.fn(() => ({ close: vi.fn(async () => undefined) })),
    toNodeHandler: vi.fn(() => vi.fn(async () => undefined)),
    createModernMcpServer: vi.fn(() => ({})),
    readBodyWithLimit: vi.fn(async () => ({ jsonrpc: '2.0', method: 'ping', id: 1 })),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() },
  };
});

vi.mock('node:http', () => ({
  createServer: (handler: (req: unknown, res: unknown) => void) => {
    const server = {
      requestHandlerForTest: handler,
      requestTimeout: 0,
      headersTimeout: 0,
      keepAliveTimeout: 0,
      listen: vi.fn((_: number, __: string, cb?: () => void) => cb?.()),
      on: vi.fn(() => server),
      emit: vi.fn(),
      close: vi.fn((cb?: () => void) => cb?.()),
    };
    mocks.httpServers.push(server);
    return server;
  },
}));
vi.mock('@server/http/HttpMiddleware', () => ({
  checkOrigin: () => true,
  checkAuth: () => true,
  checkRateLimit: () => true,
  readBodyWithLimit: mocks.readBodyWithLimit,
}));
vi.mock('@server/http/EventsEndpoint', () => ({ createEventsEndpoint: () => null }));
vi.mock('@utils/logger', () => ({ logger: mocks.logger }));
vi.mock('@utils/ProcessRegistry', () => ({ ProcessRegistry: { shutdownAll: vi.fn() } }));
vi.mock('@modelcontextprotocol/server', async (importOriginal) => {
  const actual = await importOriginal<typeof SdkServer>();
  return { ...actual, createMcpHandler: mocks.createMcpHandler };
});
vi.mock('@modelcontextprotocol/node', () => ({ toNodeHandler: mocks.toNodeHandler }));
vi.mock('@server/MCPServer.modern', () => ({
  createModernMcpServer: mocks.createModernMcpServer,
}));
vi.mock('@server/mcp2/contract', () => ({
  assertMcp2Contract: mocks.assertMcp2Contract,
}));
vi.mock('@server/transport/MultiplexedStreamableHttpTransport', () => ({
  MultiplexedStreamableHttpTransport: class {
    public handleRequest = vi.fn();
    public onclose?: () => void;
    public onerror?: (e: Error) => void;
    public onmessage?: (...a: unknown[]) => void;
    // No parameter property: erasableSyntaxOnly forbids it.
  },
}));

import { startHttpTransport } from '@server/MCPServer.transport';
import type { MCPServerContext } from '@server/MCPServer.context';

function createCtx(): MCPServerContext {
  return {
    server: { connect: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    eventBus: null,
    getDomainInstance: () => undefined,
    setDomainInstance: vi.fn(),
    config: { mcp: { browserFleetMaxLocalLeases: 4 }, server: { http: {} } },
    httpSockets: new Set(),
  } as unknown as MCPServerContext;
}

describe('/mcp/v2 modern handler init verifies the mcp2 contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpServers.length = 0;
    mocks.readBodyWithLimit.mockResolvedValue({ jsonrpc: '2.0', method: 'ping', id: 1 });
  });

  it('calls assertMcp2Contract once when the lazy v2 handler is built', async () => {
    const { promise: guardRan, resolve: markGuardRan } = Promise.withResolvers<void>();
    mocks.assertMcp2Contract.mockImplementation(() => markGuardRan());

    await startHttpTransport(createCtx());
    const server = mocks.httpServers[0];
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn(),
      headersSent: false,
    };

    server!.requestHandlerForTest({ url: '/mcp/v2', method: 'POST', headers: {} }, res);
    expect(mocks.readBodyWithLimit).toHaveBeenCalled();
    // Await the real event (the guard running), not a guessed duration. The
    // four dynamic import() ticks all settle before the guard is invoked.
    await guardRan;

    expect(mocks.createMcpHandler).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ legacy: 'reject' }),
    );
    expect(mocks.assertMcp2Contract).toHaveBeenCalledTimes(1);
  });

  it('runs the guard only once across repeated v2 requests (lazy singleton)', async () => {
    const { promise: guardRan, resolve: markGuardRan } = Promise.withResolvers<void>();
    mocks.assertMcp2Contract.mockImplementation(() => markGuardRan());

    await startHttpTransport(createCtx());
    const server = mocks.httpServers[0];
    const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn(), headersSent: false };

    server!.requestHandlerForTest({ url: '/mcp/v2', method: 'POST', headers: {} }, res);
    await guardRan;
    // Flush the remainder of the first init so modernHandlerPromise resolves
    // before the second request recreates it.
    await Promise.resolve();
    await Promise.resolve();
    server!.requestHandlerForTest({ url: '/mcp/v2', method: 'POST', headers: {} }, res);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.assertMcp2Contract).toHaveBeenCalledTimes(1);
  });
});
