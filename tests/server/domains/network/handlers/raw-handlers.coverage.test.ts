import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dnsResolve: vi.fn(),
  dnsReverse: vi.fn(),
  resolveAuthorizedTransportTarget: vi.fn(),
  exchangePlainHttp: vi.fn(),
  performHttp2ProbeInternal: vi.fn(),
  icmpProbe: vi.fn(),
  traceroute: vi.fn(),
  isIcmpAvailable: vi.fn(() => true),
  netCreateConnection: vi.fn(),
  tlsConnect: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  resolve: (...args: unknown[]) => state.dnsResolve(...args),
  reverse: (...args: unknown[]) => state.dnsReverse(...args),
}));

vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  return {
    ...actual,
    createConnection: (...args: unknown[]) => state.netCreateConnection(...args),
  };
});

vi.mock('node:tls', async () => {
  const actual = await vi.importActual<typeof import('node:tls')>('node:tls');
  return {
    ...actual,
    connect: (...args: unknown[]) => state.tlsConnect(...args),
  };
});

vi.mock('@server/domains/network/handlers/raw-helpers', async () => {
  const actual = await vi.importActual<
    typeof import('@server/domains/network/handlers/raw-helpers')
  >('@server/domains/network/handlers/raw-helpers');
  return {
    ...actual,
    resolveAuthorizedTransportTarget: (...args: unknown[]) =>
      state.resolveAuthorizedTransportTarget(...args),
    exchangePlainHttp: (...args: unknown[]) => state.exchangePlainHttp(...args),
    performHttp2ProbeInternal: (...args: unknown[]) => state.performHttp2ProbeInternal(...args),
  };
});

vi.mock('@native/IcmpProbe', () => ({
  icmpProbe: (...args: unknown[]) => state.icmpProbe(...args),
  traceroute: (...args: unknown[]) => state.traceroute(...args),
  isIcmpAvailable: () => state.isIcmpAvailable(),
}));

import { RawHandlers } from '@server/domains/network/handlers/raw-handlers';

function parseJsonResponse(response: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = response.content[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Expected text response');
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function parseTextResponse(response: {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}) {
  return {
    text: response.content[0]?.text ?? '',
    isError: response.isError ?? false,
  };
}

class MockSocket extends EventEmitter {
  public readonly destroy = vi.fn(() => this);
  public readonly setTimeout = vi.fn((_timeoutMs: number) => this);
  public written: Buffer = Buffer.from('');

  constructor(private readonly onWrite?: (socket: MockSocket) => void) {
    super();
  }

  public readonly end = vi.fn((data?: string | Buffer) => {
    this.written = Buffer.isBuffer(data) ? data : Buffer.from(data ?? '', 'utf8');
    queueMicrotask(() => {
      this.onWrite?.(this);
    });
    return this;
  });
}

describe('RawHandlers', () => {
  let handler: RawHandlers;
  let eventBus: { emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = { emit: vi.fn() };
    handler = new RawHandlers(eventBus as never);
  });

  describe('DNS handlers', () => {
    it('validates required DNS resolve args and rrType', async () => {
      const missing = await handler.handleDnsResolve({});
      expect(parseTextResponse(missing)).toEqual({ text: 'hostname is required', isError: true });

      const invalid = await handler.handleDnsResolve({ hostname: 'example.com', rrType: 'BAD' });
      expect(parseTextResponse(invalid).text).toContain('Invalid rrType');
    });

    it('resolves and reverse-resolves DNS records', async () => {
      state.dnsResolve.mockResolvedValue(['93.184.216.34']);
      state.dnsReverse.mockResolvedValue(['example.com']);

      const resolved = parseJsonResponse(
        await handler.handleDnsResolve({ hostname: 'example.com', rrType: 'A' }),
      );
      const reversed = parseJsonResponse(await handler.handleDnsReverse({ ip: '93.184.216.34' }));

      expect(resolved.records).toEqual(['93.184.216.34']);
      expect(reversed.hostnames).toEqual(['example.com']);
    });

    it('returns structured failures when DNS lookups throw', async () => {
      state.dnsResolve.mockRejectedValue(new Error('NXDOMAIN'));
      state.dnsReverse.mockRejectedValue(new Error('NOTFOUND'));

      const resolved = parseJsonResponse(
        await handler.handleDnsResolve({ hostname: 'missing.example', rrType: 'A' }),
      );
      const reversed = parseJsonResponse(await handler.handleDnsReverse({ ip: '1.1.1.1' }));

      expect(resolved.success).toBe(false);
      expect(String(resolved.error)).toContain('DNS resolve failed');
      expect(reversed.success).toBe(false);
      expect(String(reversed.error)).toContain('DNS reverse lookup failed');
    });
  });

  describe('handleHttpRequestBuild', () => {
    it('returns failures for missing required fields and builds valid requests', async () => {
      const missingMethod = parseJsonResponse(
        await handler.handleHttpRequestBuild({ target: '/' }),
      );
      const missingTarget = parseJsonResponse(
        await handler.handleHttpRequestBuild({ method: 'GET' }),
      );
      expect(missingMethod.success).toBe(false);
      expect(missingTarget.success).toBe(false);

      const built = parseJsonResponse(
        await handler.handleHttpRequestBuild({
          method: 'POST',
          target: '/submit',
          host: 'example.com',
          headers: { 'Content-Type': 'application/json' },
          body: '{"ok":true}',
        }),
      );

      expect(built.startLine).toBe('POST /submit HTTP/1.1');
      expect(String(built.requestText)).toContain('Host: example.com');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'network:http_request_built',
        expect.objectContaining({ target: '/submit', byteLength: expect.any(Number) }),
      );
    });
  });

  describe('handleHttpPlainRequest', () => {
    beforeEach(() => {
      state.resolveAuthorizedTransportTarget.mockResolvedValue({
        url: new URL('http://allowed.example/'),
        target: { hostname: 'allowed.example', resolvedAddress: '93.184.216.34' },
      });
    });

    it('validates required args', async () => {
      const missingHost = parseJsonResponse(await handler.handleHttpPlainRequest({}));
      const missingRequest = parseJsonResponse(
        await handler.handleHttpPlainRequest({ host: 'allowed.example' }),
      );
      expect(missingHost.success).toBe(false);
      expect(missingRequest.success).toBe(false);
    });

    it('blocks request-line absolute URLs that do not match the authorized host', async () => {
      const response = parseJsonResponse(
        await handler.handleHttpPlainRequest({
          host: 'allowed.example',
          requestText: 'GET http://other.example/ HTTP/1.1\r\nHost: allowed.example\r\n\r\n',
          authorization: { allowedHosts: ['allowed.example'], allowInsecureHttp: true },
        }),
      );

      expect(response.success).toBe(false);
      expect(String(response.error)).toContain('request-line target host');
    });

    it('blocks Host headers that do not match the authorized host', async () => {
      const response = parseJsonResponse(
        await handler.handleHttpPlainRequest({
          host: 'allowed.example',
          requestText: 'GET / HTTP/1.1\r\nHost: wrong.example\r\n\r\n',
          authorization: { allowedHosts: ['allowed.example'], allowInsecureHttp: true },
        }),
      );

      expect(response.success).toBe(false);
      expect(String(response.error)).toContain('Host header');
    });

    it('returns text HTTP responses and emits completion events', async () => {
      state.exchangePlainHttp.mockResolvedValue({
        rawResponse: Buffer.from(
          'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: text/plain\r\n\r\nok',
          'utf8',
        ),
        endedBy: 'content-length',
      });

      const response = parseJsonResponse(
        await handler.handleHttpPlainRequest({
          host: 'allowed.example',
          requestText: 'GET / HTTP/1.1\r\nHost: allowed.example\r\n\r\n',
        }),
      );

      expect(response.success).toBe(true);
      expect(response.resolvedAddress).toBe('93.184.216.34');
      expect((response.response as Record<string, unknown>).bodyText).toBe('ok');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'network:http_plain_request_completed',
        expect.objectContaining({ statusCode: 200 }),
      );
    });

    it('returns binary payloads as base64 and handles unparseable responses', async () => {
      state.exchangePlainHttp.mockResolvedValueOnce({
        rawResponse: Buffer.concat([
          Buffer.from(
            'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: application/octet-stream\r\n\r\n',
            'utf8',
          ),
          Buffer.from([0x00, 0xff]),
        ]),
        endedBy: 'content-length',
      });

      const binary = parseJsonResponse(
        await handler.handleHttpPlainRequest({
          host: 'allowed.example',
          requestText: 'GET / HTTP/1.1\r\nHost: allowed.example\r\n\r\n',
        }),
      );
      expect((binary.response as Record<string, unknown>).bodyBase64).toBe(
        Buffer.from([0x00, 0xff]).toString('base64'),
      );

      state.exchangePlainHttp.mockResolvedValueOnce({
        rawResponse: Buffer.from('garbage', 'utf8'),
        endedBy: 'socket-close',
      });
      const invalid = parseJsonResponse(
        await handler.handleHttpPlainRequest({
          host: 'allowed.example',
          requestText: 'GET / HTTP/1.1\r\nHost: allowed.example\r\n\r\n',
        }),
      );
      expect(invalid.success).toBe(false);
      expect(String(invalid.error)).toContain('could not parse complete HTTP response headers');
    });
  });

  describe('handleHttp2Probe', () => {
    beforeEach(() => {
      state.resolveAuthorizedTransportTarget.mockResolvedValue({
        url: new URL('https://api.example/data'),
        target: { hostname: 'api.example', resolvedAddress: '1.2.3.4' },
      });
    });

    it('validates url and method', async () => {
      const missingUrl = parseJsonResponse(await handler.handleHttp2Probe({}));
      const invalidMethod = parseJsonResponse(
        await handler.handleHttp2Probe({ url: 'https://api.example', method: 'bad value' }),
      );

      expect(missingUrl.success).toBe(false);
      expect(String(missingUrl.error)).toContain('url is required');
      expect(invalidMethod.success).toBe(false);
      expect(String(invalidMethod.error)).toContain('method must be a valid HTTP token');
    });

    it('returns text and binary HTTP/2 probe responses and emits completion events', async () => {
      state.performHttp2ProbeInternal.mockResolvedValueOnce({
        responseHeaders: { ':status': '200', 'content-type': 'text/plain' },
        bodyBuffer: Buffer.from('ok', 'utf8'),
        truncated: false,
        alpnProtocol: 'h2',
      });
      const textResponse = parseJsonResponse(
        await handler.handleHttp2Probe({ url: 'https://api.example/data', method: 'GET' }),
      );
      expect(textResponse.statusCode).toBe(200);
      expect(textResponse.bodyText).toBe('ok');

      state.performHttp2ProbeInternal.mockResolvedValueOnce({
        responseHeaders: { ':status': 204, 'content-type': 'application/octet-stream' },
        bodyBuffer: Buffer.from([0x00, 0xff]),
        truncated: true,
        alpnProtocol: 'h2',
      });
      const binaryResponse = parseJsonResponse(
        await handler.handleHttp2Probe({ url: 'https://api.example/data', method: 'POST' }),
      );
      expect(binaryResponse.bodyBase64).toBe(Buffer.from([0x00, 0xff]).toString('base64'));
      expect(binaryResponse.truncated).toBe(true);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'network:http2_probed',
        expect.objectContaining({ success: true, alpnProtocol: 'h2' }),
      );
    });

    it('returns failures when the probe throws while still emitting the final event', async () => {
      state.performHttp2ProbeInternal.mockRejectedValue(new Error('probe failed'));

      const response = parseJsonResponse(
        await handler.handleHttp2Probe({ url: 'https://api.example/data' }),
      );
      expect(response.success).toBe(false);
      expect(String(response.error)).toContain('probe failed');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'network:http2_probed',
        expect.objectContaining({ success: false }),
      );
    });
  });

  describe('handleHttp2FrameBuild', () => {
    it('validates frame input and builds HTTP/2 frames', async () => {
      await expect(handler.handleHttp2FrameBuild({})).rejects.toThrow('frameType is required');
      await expect(handler.handleHttp2FrameBuild({ frameType: 'bad' })).rejects.toThrow(
        'frameType must be one of',
      );
      await expect(
        handler.handleHttp2FrameBuild({ frameType: 'SETTINGS', settings: 'bad' }),
      ).rejects.toThrow('settings must be an array');
      await expect(
        handler.handleHttp2FrameBuild({
          frameType: 'SETTINGS',
          settings: [{ id: 'bad', value: 1 }],
        }),
      ).rejects.toThrow('settings[0].id must be a number');

      const built = parseJsonResponse(
        await handler.handleHttp2FrameBuild({
          frameType: 'PING',
          ack: true,
          pingOpaqueDataHex: '0102030405060708',
        }),
      );
      expect(built.frameType).toBe('PING');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'network:http2_frame_build_completed',
        expect.objectContaining({ frameType: 'PING', payloadBytes: 8 }),
      );
    });
  });

  describe('RTT measurement and probe helpers', () => {
    it('validates RTT request input and aggregates successes with errors', async () => {
      await expect(handler.handleNetworkRttMeasure({})).rejects.toThrow('url is required');
      await expect(
        handler.handleNetworkRttMeasure({ url: 'https://example.com', probeType: 'udp' }),
      ).rejects.toThrow('probeType must be one of: tcp, tls, http');

      state.resolveAuthorizedTransportTarget.mockResolvedValue({
        url: new URL('https://example.com/'),
        target: { hostname: 'example.com', resolvedAddress: '93.184.216.34' },
      });
      const typedHandler = handler as unknown as {
        measureSingleRtt: (
          host: string,
          port: number,
          probeType: 'tcp' | 'tls' | 'http',
          timeoutMs: number,
        ) => Promise<number>;
      };
      const measureSpy = vi
        .spyOn(typedHandler, 'measureSingleRtt')
        .mockResolvedValueOnce(12.34)
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(18.76);

      const response = parseJsonResponse(
        await handler.handleNetworkRttMeasure({
          url: 'https://example.com',
          iterations: 3,
          timeoutMs: 1000,
        }),
      );

      expect(measureSpy).toHaveBeenCalledTimes(3);
      expect((response.stats as Record<string, unknown>).count).toBe(2);
      expect(response.errors).toEqual(['timeout']);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'network:rtt_measured',
        expect.objectContaining({ successCount: 2, errorCount: 1 }),
      );
    });

    it('dispatches measureSingleRtt to probeTcp, probeTls, and probeHttp', async () => {
      const typedHandler = handler as unknown as {
        probeTcp: (host: string, port: number, timeoutMs: number) => Promise<number>;
        probeTls: (host: string, port: number, timeoutMs: number) => Promise<number>;
        probeHttp: (host: string, port: number, timeoutMs: number) => Promise<number>;
      };
      const tcpSpy = vi.spyOn(typedHandler, 'probeTcp').mockResolvedValue(1.1);
      const tlsSpy = vi.spyOn(typedHandler, 'probeTls').mockResolvedValue(2.2);
      const httpSpy = vi.spyOn(typedHandler, 'probeHttp').mockResolvedValue(3.3);

      await expect((handler as any).measureSingleRtt('host', 80, 'tcp', 1000)).resolves.toBe(1.1);
      await expect((handler as any).measureSingleRtt('host', 443, 'tls', 1000)).resolves.toBe(2.2);
      await expect((handler as any).measureSingleRtt('host', 443, 'http', 1000)).resolves.toBe(3.3);

      expect(tcpSpy).toHaveBeenCalledWith('host', 80, 1000);
      expect(tlsSpy).toHaveBeenCalledWith('host', 443, 1000);
      expect(httpSpy).toHaveBeenCalledWith('host', 443, 1000);
    });

    it('probes TCP successfully and reports TCP errors/timeouts', async () => {
      state.netCreateConnection.mockImplementationOnce(
        (_options: unknown, onConnect: () => void) => {
          const socket = new MockSocket();
          queueMicrotask(() => onConnect());
          return socket;
        },
      );
      await expect((handler as any).probeTcp('host', 80, 1000)).resolves.toBeTypeOf('number');

      state.netCreateConnection.mockImplementationOnce(() => {
        const socket = new MockSocket();
        queueMicrotask(() => socket.emit('error', new Error('tcp failed')));
        return socket;
      });
      await expect((handler as any).probeTcp('host', 80, 1000)).rejects.toThrow('tcp failed');

      state.netCreateConnection.mockImplementationOnce(() => {
        const socket = new MockSocket();
        queueMicrotask(() => socket.emit('timeout'));
        return socket;
      });
      await expect((handler as any).probeTcp('host', 80, 1000)).rejects.toThrow(
        'TCP probe timed out after 1000ms',
      );
    });

    it('probes TLS successfully and reports TLS errors/timeouts', async () => {
      state.tlsConnect.mockImplementationOnce((_options: unknown, onConnect: () => void) => {
        const socket = new MockSocket();
        queueMicrotask(() => onConnect());
        return socket;
      });
      await expect((handler as any).probeTls('host', 443, 1000)).resolves.toBeTypeOf('number');

      state.tlsConnect.mockImplementationOnce(() => {
        const socket = new MockSocket();
        queueMicrotask(() => socket.emit('error', new Error('tls failed')));
        return socket;
      });
      await expect((handler as any).probeTls('host', 443, 1000)).rejects.toThrow('tls failed');

      state.tlsConnect.mockImplementationOnce(() => {
        const socket = new MockSocket();
        queueMicrotask(() => socket.emit('timeout'));
        return socket;
      });
      await expect((handler as any).probeTls('host', 443, 1000)).rejects.toThrow(
        'TLS probe timed out after 1000ms',
      );
    });

    it('probes HTTP using a HEAD request and respects the inferred protocol', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      const result = await (handler as any).probeHttp('example.com', 443, 1000);
      expect(typeof result).toBe('number');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com:443/',
        expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
      );
    });
  });

  describe('ICMP helpers', () => {
    it('returns ICMP availability errors and success payloads for traceroute/probe', async () => {
      state.isIcmpAvailable.mockReturnValue(false);
      const unavailableTraceroute = await handler.handleNetworkTraceroute({});
      const unavailableProbe = await handler.handleNetworkIcmpProbe({});
      expect(parseTextResponse(unavailableTraceroute).isError).toBe(true);
      expect(parseTextResponse(unavailableProbe).isError).toBe(true);

      state.isIcmpAvailable.mockReturnValue(true);
      const missingTarget = await handler.handleNetworkTraceroute({});
      expect(parseTextResponse(missingTarget)).toEqual({
        text: 'target is required',
        isError: true,
      });

      state.traceroute.mockReturnValue({ hops: [{ ttl: 1, host: 'router' }] });
      const tracerouteResponse = parseJsonResponse(
        await handler.handleNetworkTraceroute({ target: 'example.com', maxHops: 5 }),
      );
      expect(tracerouteResponse.hops as Array<unknown>).toHaveLength(1);

      state.icmpProbe.mockReturnValue({ success: true, rttMs: 12.3 });
      const probeResponse = parseJsonResponse(
        await handler.handleNetworkIcmpProbe({ target: 'example.com', ttl: 64 }),
      );
      expect(probeResponse.success).toBe(true);
      expect(probeResponse.rttMs).toBe(12.3);
    });

    it('wraps traceroute/probe exceptions in fail responses', async () => {
      state.isIcmpAvailable.mockReturnValue(true);
      state.traceroute.mockImplementation(() => {
        throw new Error('trace failed');
      });
      state.icmpProbe.mockImplementation(() => {
        throw new Error('icmp failed');
      });

      const tracerouteResponse = parseJsonResponse(
        await handler.handleNetworkTraceroute({ target: 'example.com' }),
      );
      const probeResponse = parseJsonResponse(
        await handler.handleNetworkIcmpProbe({ target: 'example.com' }),
      );

      expect(tracerouteResponse.success).toBe(false);
      expect(String(tracerouteResponse.error)).toContain('Traceroute failed');
      expect(probeResponse.success).toBe(false);
      expect(String(probeResponse.error)).toContain('ICMP probe failed');
    });
  });
});
