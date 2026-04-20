import {
  createCodeCollectorMock,
  parseJson,
  // @ts-expect-error — auto-suppressed [TS1484]
  NetworkRequestsResponse,
} from '@tests/server/domains/shared/mock-factories';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const replayRequestMock = vi.fn();
const { dnsLookupMock, dnsReverseMock } = vi.hoisted(() => ({
  dnsLookupMock: vi.fn(),
  dnsReverseMock: vi.fn(),
}));

vi.mock('@src/server/domains/network/replay', () => ({
  replayRequest: (...args: any[]) => replayRequestMock(...args),
}));

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: (...args: any[]) => dnsLookupMock(...args),
    reverse: (...args: any[]) => dnsReverseMock(...args),
  };
});

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: any) => payload,
    }),
  },
}));

import { AdvancedToolHandlers } from '@server/domains/network/handlers';

describe('AdvancedToolHandlers (network)', () => {
  const collector = createCodeCollectorMock();
  const eventBus = { emit: vi.fn() } as any;
  const consoleMonitor = {
    isNetworkEnabled: vi.fn(),
    enable: vi.fn(),
    getNetworkStatus: vi.fn(),
    getNetworkRequests: vi.fn(),
    getResponseBody: vi.fn(),
    disable: vi.fn(),
  } as any;

  let handlers: AdvancedToolHandlers;
  let httpServer: NetServer;
  let httpPort: number;

  beforeAll(async () => {
    httpServer = createNetServer((socket) => {
      socket.on('data', (chunk) => {
        const request = chunk.toString('utf8');
        const body = `echo:${request.split('\r\n')[0]}`;
        socket.end(
          `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body, 'utf8')}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${body}`,
        );
      });
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
    httpPort = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error — auto-suppressed [TS2345]
    handlers = new AdvancedToolHandlers(collector, consoleMonitor, eventBus);
    dnsLookupMock.mockImplementation(async (_hostname: string, options?: { all?: boolean }) =>
      options?.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 },
    );
    dnsReverseMock.mockResolvedValue(['localhost']);
  });

  it('enables network with parsed boolean args', async () => {
    consoleMonitor.getNetworkStatus.mockReturnValue({
      enabled: true,
      cdpSessionActive: true,
      listenerCount: 1,
    });

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkMonitor({ action: 'enable', enableExceptions: '0' }),
    );
    expect(consoleMonitor.enable).toHaveBeenCalledWith({
      enableNetwork: true,
      enableExceptions: false,
    });
    expect(body.success).toBe(true);
  });

  it('returns disabled status payload when monitoring is off', async () => {
    consoleMonitor.getNetworkStatus.mockReturnValue({
      enabled: false,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: false,
    });

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkMonitor({ action: 'status' }),
    );
    expect(body.success).toBe(false);
    // @ts-expect-error — auto-suppressed [TS2339]
    expect(body.enabled).toBe(false);
  });

  it('returns guidance when get_requests called with monitoring disabled', async () => {
    consoleMonitor.isNetworkEnabled.mockReturnValue(false);
    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkGetRequests({ autoEnable: false }),
    );
    expect(body.success).toBe(false);
    expect(body.message).toContain('not enabled');
  });

  it('auto-enables and reports empty capture set', async () => {
    consoleMonitor.isNetworkEnabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
    consoleMonitor.getNetworkRequests.mockReturnValue([]);

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkGetRequests({ autoEnable: true }),
    );
    expect(consoleMonitor.enable).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.total).toBe(0);
    expect(body.message).toContain('No network requests captured');
  });

  it('filters and paginates captured requests', async () => {
    consoleMonitor.isNetworkEnabled.mockReturnValue(true);
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: '1', url: 'https://vmoranv.github.io/jshookmcp/api/a', method: 'GET' },
      { requestId: '2', url: 'https://vmoranv.github.io/jshookmcp/api/b', method: 'POST' },
      { requestId: '3', url: 'https://vmoranv.github.io/jshookmcp/cdn/c', method: 'GET' },
    ]);

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkGetRequests({
        url: 'jshookmcp/api/',
        method: 'ALL',
        limit: 1,
        offset: 1,
      }),
    );
    expect(body.success).toBe(true);
    // @ts-expect-error — auto-suppressed [TS18048]
    expect(body.page.returned).toBe(1);
    // @ts-expect-error — auto-suppressed [TS18048]
    expect(body.page.totalAfterFilter).toBe(2);
    // @ts-expect-error — auto-suppressed [TS2532]
    expect(body.requests[0].requestId).toBe('2');
  });

  it('validates network_replay_request requires requestId', async () => {
    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkReplayRequest({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain('requestId is required');
  });

  it('replays captured request with dryRun default true', async () => {
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: 'abc', url: 'https://api', method: 'POST' },
    ]);
    replayRequestMock.mockResolvedValue({ dryRun: true, requestId: 'abc' });

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkReplayRequest({ requestId: 'abc' }),
    );
    expect(replayRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'abc' }),
      expect.objectContaining({ requestId: 'abc', dryRun: true }),
    );
    expect(body.success).toBe(true);
    // @ts-expect-error — auto-suppressed [TS2339]
    expect(body.dryRun).toBe(true);
  });

  it('passes explicit replay authorization to replayRequest', async () => {
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: 'abc', url: 'https://api', method: 'POST' },
    ]);
    replayRequestMock.mockResolvedValue({ dryRun: false, requestId: 'abc' });

    await handlers.handleNetworkReplayRequest({
      requestId: 'abc',
      dryRun: false,
      authorization: {
        allowedHosts: ['lab.example.com'],
        allowedCidrs: ['10.0.0.0/24'],
        allowPrivateNetwork: true,
        allowInsecureHttp: true,
        expiresAt: '2030-01-01T00:00:00.000Z',
        reason: 'authorized testing',
      },
    });

    expect(replayRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authorization: {
          allowedHosts: ['lab.example.com'],
          allowedCidrs: ['10.0.0.0/24'],
          allowPrivateNetwork: true,
          allowInsecureHttp: true,
          expiresAt: '2030-01-01T00:00:00.000Z',
          reason: 'authorized testing',
        },
      }),
    );
  });

  it('decodes authorizationCapability and binds it to requestId', async () => {
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: 'abc', url: 'https://api', method: 'POST' },
    ]);
    replayRequestMock.mockResolvedValue({ dryRun: false, requestId: 'abc' });
    const authorizationCapability = Buffer.from(
      JSON.stringify({
        version: 1,
        requestId: 'abc',
        allowedHosts: ['lab.example.com'],
        allowInsecureHttp: true,
      }),
    ).toString('base64url');

    await handlers.handleNetworkReplayRequest({
      requestId: 'abc',
      dryRun: false,
      authorizationCapability,
    });

    expect(replayRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authorization: {
          allowedHosts: ['lab.example.com'],
          allowInsecureHttp: true,
        },
      }),
    );
  });

  it('rejects authorizationCapability when requestId does not match', async () => {
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: 'abc', url: 'https://api', method: 'POST' },
    ]);
    const authorizationCapability = Buffer.from(
      JSON.stringify({
        version: 1,
        requestId: 'other',
        allowedHosts: ['lab.example.com'],
        allowInsecureHttp: true,
      }),
    ).toString('base64url');

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkReplayRequest({
        requestId: 'abc',
        authorizationCapability,
      }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toContain('requestId does not match');
  });

  it('builds raw HTTP requests deterministically', async () => {
    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleHttpRequestBuild({
        method: 'post',
        target: '/submit',
        host: 'example.test',
        headers: { 'X-Test': '1' },
        body: 'hello',
        addHostHeader: true,
        addContentLength: true,
      }),
    );

    expect(body.success).toBe(true);
    // @ts-expect-error
    expect(body.requestText).toContain('POST /submit HTTP/1.1');
    // @ts-expect-error
    expect(body.requestText).toContain('Host: example.test');
    // @ts-expect-error
    expect(body.requestText).toContain('Content-Length: 5');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'network:http_request_built',
      expect.objectContaining({ method: 'POST', target: '/submit' }),
    );
  });

  it('sends plain HTTP requests over TCP sockets', async () => {
    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleHttpPlainRequest({
        host: '127.0.0.1',
        port: httpPort,
        requestText: 'GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
      }),
    );

    expect(body.success).toBe(true);
    // @ts-expect-error
    expect(body.response.statusCode).toBe(200);
    // @ts-expect-error
    expect(body.response.bodyText).toContain('GET /ping HTTP/1.1');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'network:http_plain_request_completed',
      expect.objectContaining({ host: '127.0.0.1', port: httpPort, statusCode: 200 }),
    );
  });

  it('blocks non-loopback plain HTTP without explicit authorization', async () => {
    dnsLookupMock.mockImplementation(async (_hostname: string, options?: { all?: boolean }) =>
      options?.all
        ? [{ address: '93.184.216.34', family: 4 }]
        : { address: '93.184.216.34', family: 4 },
    );

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleHttpPlainRequest({
        host: 'example.com',
        port: 80,
        requestText: 'GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n',
      }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toContain('insecure HTTP is only allowed');
  });
});
