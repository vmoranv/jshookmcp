import { EventEmitter } from 'node:events';
import type { LookupAddress } from 'node:dns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ssrfState = vi.hoisted(() => ({
  createNetworkAuthorizationPolicy: vi.fn(),
  hasAuthorizedTargets: vi.fn(),
  isAuthorizedNetworkTarget: vi.fn(),
  isLocalSsrfBypassEnabled: vi.fn(),
  isLoopbackHost: vi.fn(),
  isNetworkAuthorizationExpired: vi.fn(),
  isPrivateHost: vi.fn(),
  resolveNetworkTarget: vi.fn(),
  netCreateConnection: vi.fn(),
  tlsConnect: vi.fn(),
  http2Connect: vi.fn(),
}));

vi.mock('@server/domains/network/ssrf-policy', () => ({
  createNetworkAuthorizationPolicy: (...args: unknown[]) =>
    ssrfState.createNetworkAuthorizationPolicy(...args),
  hasAuthorizedTargets: (...args: unknown[]) => ssrfState.hasAuthorizedTargets(...args),
  isAuthorizedNetworkTarget: (...args: unknown[]) => ssrfState.isAuthorizedNetworkTarget(...args),
  isLocalSsrfBypassEnabled: () => ssrfState.isLocalSsrfBypassEnabled(),
  isLoopbackHost: (...args: unknown[]) => ssrfState.isLoopbackHost(...args),
  isNetworkAuthorizationExpired: (...args: unknown[]) =>
    ssrfState.isNetworkAuthorizationExpired(...args),
  isPrivateHost: (...args: unknown[]) => ssrfState.isPrivateHost(...args),
  resolveNetworkTarget: (...args: unknown[]) => ssrfState.resolveNetworkTarget(...args),
}));

vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  return {
    ...actual,
    createConnection: (...args: unknown[]) => ssrfState.netCreateConnection(...args),
    connect: (...args: unknown[]) => ssrfState.netCreateConnection(...args),
  };
});

vi.mock('node:tls', async () => {
  const actual = await vi.importActual<typeof import('node:tls')>('node:tls');
  return {
    ...actual,
    connect: (...args: unknown[]) => ssrfState.tlsConnect(...args),
  };
});

vi.mock('node:http2', async () => {
  const actual = await vi.importActual<typeof import('node:http2')>('node:http2');
  return {
    ...actual,
    connect: (...args: unknown[]) => ssrfState.http2Connect(...args),
  };
});

import {
  parseOptionalString,
  parseRawString,
  parseOptionalBoolean,
  parseStringArray,
  parseHeaderRecord,
  parseNetworkAuthorization,
  clamp,
  roundMs,
  computeRttStats,
  resolveAuthorizedTransportTarget,
  normalizeTargetHost,
  formatHostForUrl,
  getRequestMethod,
  exchangePlainHttp,
  normalizeLookupResults,
  normalizeHttp2HeaderValue,
  normalizeHttp2Headers,
  normalizeAlpnProtocol,
  toHttp2RequestHeaders,
  performHttp2ProbeInternal,
} from '@server/domains/network/handlers/raw-helpers';

class MockSocket extends EventEmitter {
  public readonly destroy = vi.fn(() => this);
  public readonly setTimeout = vi.fn((_timeoutMs: number, _onTimeout?: () => void) => this);
  public alpnProtocol = 'h2';
  public written: Buffer = Buffer.from('');

  constructor(private readonly onWrite?: (socket: MockSocket) => void) {
    super();
  }

  public readonly end = vi.fn((data?: string | Buffer) => {
    this.written = Buffer.isBuffer(data) ? data : Buffer.from(data ?? '', 'utf8');
    queueMicrotask(() => this.onWrite?.(this));
    return this;
  });
}

class MockHttp2Request extends EventEmitter {
  public readonly end = vi.fn(() => this);
  public readonly close = vi.fn((_exitCodeValue?: number) => this.emit('close'));
}

class MockHttp2Session extends EventEmitter {
  public requestInstance = new MockHttp2Request();
  public readonly close = vi.fn();
  public readonly destroy = vi.fn();
  public readonly request = vi.fn(() => this.requestInstance);
}

describe('raw-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ssrfState.createNetworkAuthorizationPolicy.mockImplementation((authorization) => authorization);
    ssrfState.hasAuthorizedTargets.mockImplementation((policy) =>
      Boolean(
        policy &&
        (((policy as Record<string, unknown>).allowedHosts as unknown[])?.length ||
          ((policy as Record<string, unknown>).allowedCidrs as unknown[])?.length),
      ),
    );
    ssrfState.isAuthorizedNetworkTarget.mockReturnValue(false);
    ssrfState.isLocalSsrfBypassEnabled.mockReturnValue(false);
    ssrfState.isLoopbackHost.mockImplementation(
      (value: string) => value === '127.0.0.1' || value === '::1' || value === 'localhost',
    );
    ssrfState.isNetworkAuthorizationExpired.mockReturnValue(false);
    ssrfState.isPrivateHost.mockImplementation((value: string) => value.startsWith('10.'));
    ssrfState.resolveNetworkTarget.mockResolvedValue({
      hostname: 'example.com',
      resolvedAddress: '93.184.216.34',
    });
  });

  describe('argument parsing helpers', () => {
    it('parses optional strings, raw strings, booleans, arrays, and header records', async () => {
      expect(parseOptionalString(' value ', 'field')).toBe('value');
      expect(parseOptionalString('   ', 'field')).toBeUndefined();
      expect(() => parseOptionalString(1, 'field')).toThrow('field must be a string');

      expect(parseRawString(' body ', 'body')).toBe(' body ');
      expect(parseRawString('', 'body')).toBeUndefined();
      expect(parseRawString('', 'body', { allowEmpty: true })).toBe('');
      expect(() => parseRawString(1, 'body')).toThrow('body must be a string');

      expect(parseOptionalBoolean(true, 'flag')).toBe(true);
      expect(parseOptionalBoolean(undefined, 'flag')).toBeUndefined();
      expect(() => parseOptionalBoolean('yes', 'flag')).toThrow('flag must be a boolean');

      expect(parseStringArray([' a ', 'b', ''], 'items')).toEqual(['a', 'b']);
      expect(parseStringArray(undefined, 'items')).toEqual([]);
      expect(() => parseStringArray(['a', 1], 'items')).toThrow(
        'items must be an array of strings',
      );

      expect(parseHeaderRecord({ 'x-test': 'ok' }, 'headers')).toEqual({ 'x-test': 'ok' });
      expect(parseHeaderRecord(undefined, 'headers')).toBeUndefined();
      expect(() => parseHeaderRecord({ 'bad header': 'x' }, 'headers')).toThrow(
        'headers contains an invalid HTTP header name: bad header',
      );
      expect(() => parseHeaderRecord({ ok: 1 }, 'headers')).toThrow('headers.ok must be a string');
    });

    it('parses network authorization payloads', async () => {
      expect(
        parseNetworkAuthorization({
          allowedHosts: [' example.com ', ''],
          allowedCidrs: ['10.0.0.0/8'],
          allowPrivateNetwork: true,
          allowInsecureHttp: true,
          expiresAt: '2026-05-01T00:00:00Z',
          reason: 'testing',
        }),
      ).toEqual({
        allowedHosts: ['example.com'],
        allowedCidrs: ['10.0.0.0/8'],
        allowPrivateNetwork: true,
        allowInsecureHttp: true,
        expiresAt: '2026-05-01T00:00:00Z',
        reason: 'testing',
      });

      expect(parseNetworkAuthorization(undefined)).toBeUndefined();
      expect(() => parseNetworkAuthorization('bad')).toThrow('authorization must be an object');
    });
  });

  describe('small pure helpers', () => {
    it('normalizes and summarizes common values', async () => {
      expect(clamp(10, 0, 5)).toBe(5);
      expect(roundMs(12.3456)).toBe(12.35);
      expect(computeRttStats([30, 10, 20])).toEqual({
        count: 3,
        minMs: 10,
        maxMs: 30,
        avgMs: 20,
        p50Ms: 20,
        p95Ms: 30,
      });
      expect(computeRttStats([])).toBeNull();
      expect(normalizeTargetHost('[::1]')).toBe('::1');
      expect(normalizeTargetHost(' example.com ')).toBe('example.com');
      expect(formatHostForUrl('::1')).toBe('[::1]');
      expect(formatHostForUrl('example.com')).toBe('example.com');
      expect(getRequestMethod('POST /test HTTP/1.1\r\nHost: example.com\r\n\r\n')).toBe('POST');
      expect(() => getRequestMethod('@@@ /test HTTP/1.1')).toThrow(
        'requestText must start with a valid HTTP request line',
      );
    });

    it('normalizes lookup results and HTTP/2 header values', async () => {
      const lookup = normalizeLookupResults('example.com', [
        { address: '2001:db8::1', family: 6 } as LookupAddress,
        { address: '10.0.0.2', family: 4 } as LookupAddress,
        { address: '10.0.0.1', family: 4 } as LookupAddress,
      ]);
      expect(lookup.map((entry) => entry.address)).toEqual(['10.0.0.1', '10.0.0.2', '2001:db8::1']);
      expect(lookup[0]).toMatchObject({ isPrivate: true, isLoopback: false });

      expect(normalizeHttp2HeaderValue(undefined)).toBeNull();
      expect(normalizeHttp2HeaderValue(['a', 'b'])).toEqual(['a', 'b']);
      expect(normalizeHttp2HeaderValue(200)).toBe('200');
      expect(normalizeHttp2Headers({ ':status': '200', 'x-test': ['a', 'b'] })).toEqual({
        ':status': '200',
        'x-test': ['a', 'b'],
      });
      expect(normalizeAlpnProtocol(false)).toBeNull();
      expect(normalizeAlpnProtocol(' h2 ')).toBe('h2');
      expect(toHttp2RequestHeaders({ 'X-Test': 'ok' })).toEqual({ 'x-test': 'ok' });
    });
  });

  describe('resolveAuthorizedTransportTarget', () => {
    it('validates URLs, schemes, and authorization configuration', async () => {
      await expect(
        resolveAuthorizedTransportTarget('::bad-url::', undefined, 'HTTP'),
      ).rejects.toThrow('url must be an absolute http:// or https:// URL');
      await expect(
        resolveAuthorizedTransportTarget('ftp://example.com', undefined, 'HTTP'),
      ).rejects.toThrow('url must use the http:// or https:// scheme');

      await expect(
        resolveAuthorizedTransportTarget(
          'https://example.com',
          { allowPrivateNetwork: true },
          'HTTP',
        ),
      ).rejects.toThrow('authorization must include at least one allowed host or CIDR');
    });

    it('rejects expired authorizations and DNS failures', async () => {
      ssrfState.isNetworkAuthorizationExpired.mockReturnValue(true);
      await expect(
        resolveAuthorizedTransportTarget(
          'https://example.com',
          { allowedHosts: ['example.com'] },
          'HTTP',
        ),
      ).rejects.toThrow('authorization expired before the request was executed');

      ssrfState.isNetworkAuthorizationExpired.mockReturnValue(false);
      ssrfState.resolveNetworkTarget.mockRejectedValue(new Error('dns failed'));
      await expect(
        resolveAuthorizedTransportTarget(
          'https://example.com',
          { allowedHosts: ['example.com'] },
          'HTTP',
        ),
      ).rejects.toThrow('HTTP blocked: DNS resolution failed');
    });

    it('blocks insecure HTTP and private targets unless explicitly authorized', async () => {
      ssrfState.resolveNetworkTarget.mockResolvedValue({
        hostname: 'public.example',
        resolvedAddress: '93.184.216.34',
      });
      await expect(
        resolveAuthorizedTransportTarget('http://public.example', undefined, 'HTTP'),
      ).rejects.toThrow('insecure HTTP is only allowed');

      ssrfState.resolveNetworkTarget.mockResolvedValue({
        hostname: 'public.example',
        resolvedAddress: '10.0.0.9',
      });
      await expect(
        resolveAuthorizedTransportTarget(
          'https://public.example',
          { allowedHosts: ['public.example'] },
          'HTTPS',
        ),
      ).rejects.toThrow('resolved to private IP 10.0.0.9');

      ssrfState.resolveNetworkTarget.mockResolvedValue({
        hostname: '10.0.0.5',
        resolvedAddress: '10.0.0.5',
      });
      await expect(
        resolveAuthorizedTransportTarget('https://10.0.0.5', undefined, 'HTTPS'),
      ).rejects.toThrow('resolves to a private or reserved address');
    });

    it('allows loopback and explicitly authorized private targets', async () => {
      ssrfState.resolveNetworkTarget.mockResolvedValue({
        hostname: '127.0.0.1',
        resolvedAddress: '127.0.0.1',
      });
      const loopback = await resolveAuthorizedTransportTarget(
        'http://127.0.0.1:8080',
        undefined,
        'HTTP',
      );
      expect(loopback.target.hostname).toBe('127.0.0.1');

      ssrfState.resolveNetworkTarget.mockResolvedValue({
        hostname: 'internal.example',
        resolvedAddress: '10.0.0.5',
      });
      ssrfState.isAuthorizedNetworkTarget.mockReturnValue(true);
      const authorized = await resolveAuthorizedTransportTarget(
        'https://internal.example',
        { allowedHosts: ['internal.example'], allowPrivateNetwork: true },
        'HTTPS',
      );
      expect(authorized.target.resolvedAddress).toBe('10.0.0.5');
    });
  });

  describe('exchangePlainHttp', () => {
    it('captures content-length, no-body, and chunked responses', async () => {
      ssrfState.netCreateConnection.mockImplementationOnce((_options: unknown) => {
        const socket = new MockSocket((self) => {
          self.emit(
            'data',
            Buffer.from(
              'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: text/plain\r\n\r\nok',
              'utf8',
            ),
          );
        });
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      });
      await expect(
        exchangePlainHttp(
          'example.com',
          80,
          Buffer.from('GET / HTTP/1.1\r\n\r\n'),
          'GET',
          1000,
          1024,
        ),
      ).resolves.toMatchObject({ endedBy: 'content-length' });

      ssrfState.netCreateConnection.mockImplementationOnce((_options: unknown) => {
        const socket = new MockSocket((self) => {
          self.emit('data', Buffer.from('HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n'));
        });
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      });
      await expect(
        exchangePlainHttp(
          'example.com',
          80,
          Buffer.from('HEAD / HTTP/1.1\r\n\r\n'),
          'HEAD',
          1000,
          1024,
        ),
      ).resolves.toMatchObject({ endedBy: 'no-body' });

      ssrfState.netCreateConnection.mockImplementationOnce((_options: unknown) => {
        const socket = new MockSocket((self) => {
          self.emit(
            'data',
            Buffer.from(
              'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nok\r\n0\r\n\r\n',
              'utf8',
            ),
          );
        });
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      });
      await expect(
        exchangePlainHttp(
          'example.com',
          80,
          Buffer.from('GET / HTTP/1.1\r\n\r\n'),
          'GET',
          1000,
          1024,
        ),
      ).resolves.toMatchObject({ endedBy: 'chunked' });
    });

    it('handles max-bytes, timeout, and socket errors', async () => {
      ssrfState.netCreateConnection.mockImplementationOnce((_options: unknown) => {
        const socket = new MockSocket((self) => {
          self.emit('data', Buffer.from('x'.repeat(2048), 'utf8'));
        });
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      });
      await expect(
        exchangePlainHttp(
          'example.com',
          80,
          Buffer.from('GET / HTTP/1.1\r\n\r\n'),
          'GET',
          1000,
          32,
        ),
      ).resolves.toMatchObject({ endedBy: 'max-bytes' });

      ssrfState.netCreateConnection.mockImplementationOnce((_options: unknown) => {
        const socket = new MockSocket();
        queueMicrotask(() => socket.emit('timeout'));
        return socket;
      });
      await expect(
        exchangePlainHttp(
          'example.com',
          80,
          Buffer.from('GET / HTTP/1.1\r\n\r\n'),
          'GET',
          1000,
          1024,
        ),
      ).rejects.toThrow('Timed out waiting for HTTP response');

      ssrfState.netCreateConnection.mockImplementationOnce((_options: unknown) => {
        const socket = new MockSocket((self) => {
          self.emit('data', Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nhi'));
          self.emit('timeout');
        });
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      });
      await expect(
        exchangePlainHttp(
          'example.com',
          80,
          Buffer.from('GET / HTTP/1.1\r\n\r\n'),
          'GET',
          1000,
          1024,
        ),
      ).resolves.toMatchObject({ endedBy: 'timeout' });

      ssrfState.netCreateConnection.mockImplementationOnce((_options: unknown) => {
        const socket = new MockSocket();
        queueMicrotask(() => socket.emit('error', new Error('socket failed')));
        return socket;
      });
      await expect(
        exchangePlainHttp(
          'example.com',
          80,
          Buffer.from('GET / HTTP/1.1\r\n\r\n'),
          'GET',
          1000,
          1024,
        ),
      ).rejects.toThrow('socket failed');
    });
  });

  describe('performHttp2ProbeInternal', () => {
    it('captures HTTPS HTTP/2 responses and ALPN metadata', async () => {
      ssrfState.tlsConnect.mockImplementation(() => {
        const socket = new MockSocket();
        socket.alpnProtocol = 'h2';
        queueMicrotask(() => socket.emit('secureConnect'));
        return socket;
      });
      ssrfState.http2Connect.mockImplementation(
        (_origin: string, options: { createConnection: () => MockSocket }) => {
          const socket = options.createConnection();
          const session = new MockHttp2Session();
          queueMicrotask(() => {
            socket.emit('secureConnect');
            session.emit('connect');
            queueMicrotask(() => {
              session.requestInstance.emit('response', {
                ':status': '200',
                'content-type': 'text/plain',
              });
              session.requestInstance.emit('data', Buffer.from('ok', 'utf8'));
              session.requestInstance.emit('end');
            });
          });
          return session as never;
        },
      );

      await expect(
        performHttp2ProbeInternal({
          url: new URL('https://api.example/data'),
          target: { hostname: 'api.example', resolvedAddress: '1.2.3.4' } as never,
          method: 'GET',
          requestHeaders: {},
          bodyBuffer: Buffer.alloc(0),
          timeoutMs: 1000,
          maxBodyBytes: 1024,
          effectivePort: 443,
          requestedAlpnProtocols: ['h2'],
        }),
      ).resolves.toMatchObject({
        alpnProtocol: 'h2',
        truncated: false,
        bodyBuffer: Buffer.from('ok', 'utf8'),
      });
    });

    it('handles truncation and session errors', async () => {
      ssrfState.netCreateConnection.mockImplementation(() => new MockSocket());
      ssrfState.http2Connect.mockImplementation(
        (_origin: string, options: { createConnection: () => MockSocket }) => {
          options.createConnection();
          const session = new MockHttp2Session();
          queueMicrotask(() => {
            session.emit('connect');
            queueMicrotask(() => {
              session.requestInstance.emit('response', { ':status': 204 });
              session.requestInstance.emit('data', Buffer.from('abcdef', 'utf8'));
            });
          });
          return session as never;
        },
      );

      await expect(
        performHttp2ProbeInternal({
          url: new URL('http://api.example/data'),
          target: { hostname: 'api.example', resolvedAddress: '1.2.3.4' } as never,
          method: 'GET',
          requestHeaders: {},
          bodyBuffer: Buffer.alloc(0),
          timeoutMs: 1000,
          maxBodyBytes: 3,
          effectivePort: 80,
          requestedAlpnProtocols: ['h2c'],
        }),
      ).resolves.toMatchObject({
        truncated: true,
        bodyBuffer: Buffer.from('abc', 'utf8'),
      });

      ssrfState.http2Connect.mockImplementationOnce(() => {
        const session = new MockHttp2Session();
        queueMicrotask(() => session.emit('error', new Error('session failed')));
        return session as never;
      });

      await expect(
        performHttp2ProbeInternal({
          url: new URL('http://api.example/data'),
          target: { hostname: 'api.example', resolvedAddress: '1.2.3.4' } as never,
          method: 'GET',
          requestHeaders: {},
          bodyBuffer: Buffer.alloc(0),
          timeoutMs: 1000,
          maxBodyBytes: 3,
          effectivePort: 80,
          requestedAlpnProtocols: ['h2c'],
        }),
      ).rejects.toThrow('session failed');
    });
  });
});
