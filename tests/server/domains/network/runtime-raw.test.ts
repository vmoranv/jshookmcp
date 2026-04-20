import { EventEmitter } from 'node:events';
import * as net from 'node:net';

import { createCodeCollectorMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  actualLookup: undefined as undefined | typeof import('node:dns/promises').lookup,
  actualReverse: undefined as undefined | typeof import('node:dns/promises').reverse,
  actualCreateConnection: undefined as undefined | typeof import('node:net').createConnection,
  lookupMock: vi.fn(),
  reverseMock: vi.fn(),
  createConnectionMock: vi.fn(),
}));

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: unknown) => payload,
    }),
  },
}));

vi.mock('@src/server/domains/shared/modules', () => ({
  PerformanceMonitor: vi.fn(),
  ConsoleMonitor: vi.fn(),
  CodeCollector: vi.fn(),
}));

vi.mock('node:dns/promises', async () => {
  const actual = await vi.importActual<typeof import('node:dns/promises')>('node:dns/promises');
  mockState.actualLookup = actual.lookup;
  mockState.actualReverse = actual.reverse;

  return {
    ...actual,
    lookup: (...args: Parameters<typeof actual.lookup>) => mockState.lookupMock(...args),
    reverse: (...args: Parameters<typeof actual.reverse>) => mockState.reverseMock(...args),
  };
});

vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  mockState.actualCreateConnection = actual.createConnection;

  return {
    ...actual,
    createConnection: (...args: Parameters<typeof actual.createConnection>) =>
      mockState.createConnectionMock(...args),
  };
});

import { AdvancedToolHandlers } from '@server/domains/network/handlers';

class MockPlainSocket extends EventEmitter {
  public readonly end = vi.fn((data?: string | Buffer) => {
    this.written = Buffer.isBuffer(data) ? data : Buffer.from(data ?? '', 'utf8');
    queueMicrotask(() => {
      this.emit('data', this.responseBuffer);
      this.emit('end');
    });
    return this;
  });

  public readonly destroy = vi.fn(() => this);
  public readonly setTimeout = vi.fn((_timeoutMs: number) => this);

  public written: Buffer = Buffer.alloc(0);

  constructor(private readonly responseBuffer: Buffer) {
    super();
  }
}

async function listenRawHttpServer(responseText: string): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      socket.end(responseText);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

describe('AdvancedToolHandlers raw DNS/HTTP handlers', () => {
  const collector = createCodeCollectorMock();
  const consoleMonitor = {
    isNetworkEnabled: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getNetworkStatus: vi.fn(),
    getNetworkRequests: vi.fn(),
    getNetworkResponses: vi.fn(),
    getResponseBody: vi.fn(),
    getExceptions: vi.fn(),
    getNetworkActivity: vi.fn(),
    evaluate: vi.fn(),
  } as any;

  let handler: AdvancedToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.lookupMock.mockImplementation((...args: any[]) =>
      (mockState.actualLookup as any)(...args),
    );
    mockState.reverseMock.mockImplementation((...args: any[]) =>
      (mockState.actualReverse as any)(...args),
    );
    mockState.createConnectionMock.mockImplementation((...args: any[]) =>
      (mockState.actualCreateConnection as any)(...args),
    );

    handler = new AdvancedToolHandlers(collector as any, consoleMonitor as any);
    (handler as any).performanceMonitor = {
      getPerformanceMetrics: vi.fn(),
      getPerformanceTimeline: vi.fn(),
      startCoverage: vi.fn(),
      stopCoverage: vi.fn(),
      takeHeapSnapshot: vi.fn(),
      startTracing: vi.fn(),
      stopTracing: vi.fn(),
      startCPUProfiling: vi.fn(),
      stopCPUProfiling: vi.fn(),
      startHeapSampling: vi.fn(),
      stopHeapSampling: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('http_request_build emits deterministic CRLF-delimited request text', async () => {
    const body = parseJson<any>(
      await handler.handleHttpRequestBuild({
        method: 'POST',
        target: '/submit',
        host: 'lab.example.com',
        headers: { 'Content-Type': 'application/json' },
        body: '{"ok":true}',
      }),
    );

    expect(body.success).toBe(true);
    expect(body.startLine).toBe('POST /submit HTTP/1.1');
    expect(body.requestText).toContain('Host: lab.example.com');
    expect(body.requestText).toContain('Content-Type: application/json');
    expect(body.requestText).toContain('\r\n\r\n{"ok":true}');
  });

  it('http_plain_request executes a loopback request end-to-end', async () => {
    const responseText =
      'HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nhello';
    const server = await listenRawHttpServer(responseText);

    try {
      const body = parseJson<any>(
        await handler.handleHttpPlainRequest({
          host: '127.0.0.1',
          port: server.port,
          requestText: 'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        }),
      );

      expect(body.success).toBe(true);
      expect(body.resolvedAddress).toBe('127.0.0.1');
      expect(body.response.statusCode).toBe(200);
      expect(body.response.bodyText).toBe('hello');
      expect(body.response.complete).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('http_plain_request blocks non-loopback HTTP targets without explicit authorization', async () => {
    mockState.lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });

    const body = parseJson<any>(
      await handler.handleHttpPlainRequest({
        host: 'public.example.test',
        requestText: 'GET / HTTP/1.1\r\nHost: public.example.test\r\nConnection: close\r\n\r\n',
      }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toContain('insecure HTTP is only allowed');
    expect(mockState.createConnectionMock).not.toHaveBeenCalled();
  });

  it('http_plain_request allows explicitly authorized insecure HTTP targets', async () => {
    mockState.lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    mockState.createConnectionMock.mockImplementation(() => {
      const socket = new MockPlainSocket(
        Buffer.from(
          'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: text/plain\r\n\r\nok',
          'utf8',
        ),
      );
      queueMicrotask(() => {
        socket.emit('connect');
      });
      return socket as unknown as ReturnType<NonNullable<typeof mockState.actualCreateConnection>>;
    });

    const body = parseJson<any>(
      await handler.handleHttpPlainRequest({
        host: 'public.example.test',
        requestText: 'GET / HTTP/1.1\r\nHost: public.example.test\r\nConnection: close\r\n\r\n',
        authorization: {
          allowedHosts: ['public.example.test'],
          allowInsecureHttp: true,
          reason: 'authorized testing',
        },
      }),
    );

    expect(body.success).toBe(true);
    expect(body.resolvedAddress).toBe('93.184.216.34');
    expect(body.response.statusCode).toBe(200);
    expect(body.response.bodyText).toBe('ok');
  });

  it('http2_frame_build delegates to buildHttp2Frame and returns result', async () => {
    const body = parseJson<any>(
      await handler.handleHttp2FrameBuild({
        frameType: 'PING',
        ack: true,
        pingOpaqueDataHex: '0102030405060708',
      }),
    );
    expect(body.frameType).toBe('PING');
    expect(body.typeCode).toBe(0x6);
    expect(body.flags).toBe(1);
    expect(body.payloadBytes).toBe(8);
  });

  it('http2_frame_build throws when frameType is missing', async () => {
    await expect(handler.handleHttp2FrameBuild({})).rejects.toThrow('frameType is required');
  });

  it('http2_frame_build throws for invalid frameType', async () => {
    await expect(handler.handleHttp2FrameBuild({ frameType: 'INVALID' })).rejects.toThrow(
      'frameType must be one of',
    );
  });

  it('http2_frame_build builds a SETTINGS frame with entries', async () => {
    const body = parseJson<any>(
      await handler.handleHttp2FrameBuild({
        frameType: 'SETTINGS',
        settings: [{ id: 1, value: 4096 }],
      }),
    );
    expect(body.frameType).toBe('SETTINGS');
    expect(body.payloadBytes).toBe(6);
  });

  it('http2_frame_build throws when settings is not an array', async () => {
    await expect(
      handler.handleHttp2FrameBuild({ frameType: 'SETTINGS', settings: 'bad' }),
    ).rejects.toThrow('settings must be an array');
  });

  it('http2_frame_build throws when settings entry has non-number id', async () => {
    await expect(
      handler.handleHttp2FrameBuild({ frameType: 'SETTINGS', settings: [{ id: 'bad', value: 1 }] }),
    ).rejects.toThrow('settings[0].id must be a number');
  });
});
