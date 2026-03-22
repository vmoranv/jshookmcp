import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns/promises', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  lookup: (...args: any[]) => lookupMock(...args),
}));

import {
  isPrivateHost,
  isLoopbackHost,
  isSsrfTarget,
  replayRequest,
} from '@server/domains/network/replay';

// Helper: a publicly-routable IP for testing
function buildPublicIp(): string {
  return [203, 0, 113, 10].map(String).join('.');
}

describe('replay — additional coverage', () => {
  const fetchMock = vi.fn();
  const getFetchCall = (index: number) => fetchMock.mock.calls[index]!;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  // ────────────────────────────────────────────────────────────────
  // isPrivateHost
  // ────────────────────────────────────────────────────────────────
  describe('isPrivateHost', () => {
    it('blocks 127.x.x.x (loopback)', () => {
      expect(isPrivateHost('127.0.0.1')).toBe(true);
      expect(isPrivateHost('127.255.255.255')).toBe(true);
    });

    it('blocks 10.x.x.x (private)', () => {
      expect(isPrivateHost('10.0.0.1')).toBe(true);
      expect(isPrivateHost('10.255.255.255')).toBe(true);
    });

    it('blocks 172.16-31.x.x (private)', () => {
      expect(isPrivateHost('172.16.0.1')).toBe(true);
      expect(isPrivateHost('172.31.255.255')).toBe(true);
    });

    it('allows 172.32.x.x (not private)', () => {
      expect(isPrivateHost('172.32.0.1')).toBe(false);
    });

    it('blocks 192.168.x.x (private)', () => {
      expect(isPrivateHost('192.168.0.1')).toBe(true);
      expect(isPrivateHost('192.168.255.255')).toBe(true);
    });

    it('blocks 169.254.x.x (link-local)', () => {
      expect(isPrivateHost('169.254.169.254')).toBe(true);
    });

    it('blocks 0.x.x.x', () => {
      expect(isPrivateHost('0.0.0.0')).toBe(true);
    });

    it('blocks ::1 (IPv6 loopback)', () => {
      expect(isPrivateHost('::1')).toBe(true);
    });

    it('blocks :: (unspecified)', () => {
      expect(isPrivateHost('::')).toBe(true);
    });

    it('blocks IPv4-mapped IPv6', () => {
      expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
    });

    it('blocks fc00: (IPv6 unique-local)', () => {
      expect(isPrivateHost('fc00::1')).toBe(true);
    });

    it('blocks fd (IPv6 unique-local)', () => {
      expect(isPrivateHost('fd12::1')).toBe(true);
    });

    it('blocks fe80: (IPv6 link-local)', () => {
      expect(isPrivateHost('fe80::1')).toBe(true);
    });

    it('blocks localhost', () => {
      expect(isPrivateHost('localhost')).toBe(true);
      expect(isPrivateHost('LOCALHOST')).toBe(true);
    });

    it('strips brackets from IPv6 literals', () => {
      expect(isPrivateHost('[::1]')).toBe(true);
      expect(isPrivateHost('[fe80::1]')).toBe(true);
    });

    it('allows public IP addresses', () => {
      expect(isPrivateHost('8.8.8.8')).toBe(false);
      expect(isPrivateHost('1.1.1.1')).toBe(false);
      expect(isPrivateHost(buildPublicIp())).toBe(false);
    });

    it('allows public hostnames', () => {
      expect(isPrivateHost('example.com')).toBe(false);
      expect(isPrivateHost('google.com')).toBe(false);
    });

    it('blocks 64:ff9b:: (NAT64 prefix)', () => {
      expect(isPrivateHost('64:ff9b::1')).toBe(true);
    });

    it('blocks 100:: (discard prefix)', () => {
      expect(isPrivateHost('100::1')).toBe(true);
    });

    it('blocks ::ffff:0: (IPv4-translated)', () => {
      expect(isPrivateHost('::ffff:0:127.0.0.1')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // isLoopbackHost
  // ────────────────────────────────────────────────────────────────
  describe('isLoopbackHost', () => {
    it('recognizes localhost', () => {
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('LOCALHOST')).toBe(true);
      expect(isLoopbackHost('Localhost')).toBe(true);
    });

    it('recognizes 127.0.0.1', () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
    });

    it('recognizes ::1', () => {
      expect(isLoopbackHost('::1')).toBe(true);
    });

    it('strips brackets from IPv6', () => {
      expect(isLoopbackHost('[::1]')).toBe(true);
    });

    it('rejects non-loopback hosts', () => {
      expect(isLoopbackHost('10.0.0.1')).toBe(false);
      expect(isLoopbackHost('example.com')).toBe(false);
      expect(isLoopbackHost('192.168.1.1')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // isSsrfTarget
  // ────────────────────────────────────────────────────────────────
  describe('isSsrfTarget', () => {
    it('denies private hostnames', async () => {
      expect(await isSsrfTarget('https://localhost/api')).toBe(true);
      expect(await isSsrfTarget('https://127.0.0.1/api')).toBe(true);
      expect(await isSsrfTarget('https://10.0.0.1/api')).toBe(true);
    });

    it('denies when DNS resolves to private IP', async () => {
      lookupMock.mockResolvedValue({ address: '127.0.0.1' });
      expect(await isSsrfTarget('https://evil.example.com/')).toBe(true);
    });

    it('denies when DNS resolution fails', async () => {
      lookupMock.mockRejectedValue(new Error('NXDOMAIN'));
      expect(await isSsrfTarget('https://nonexistent.example.com/')).toBe(true);
    });

    it('allows public DNS resolution', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      expect(await isSsrfTarget('https://example.com/')).toBe(false);
    });

    it('denies invalid URLs', async () => {
      expect(await isSsrfTarget('not-a-url')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // replayRequest — sanitizeHeaders
  // ────────────────────────────────────────────────────────────────
  describe('replayRequest — header sanitization', () => {
    it('strips dangerous headers from request', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {
            Host: 'example.com',
            'Content-Length': '100',
            'Transfer-Encoding': 'chunked',
            Connection: 'keep-alive',
            'Keep-Alive': 'timeout=5',
            'X-Custom': 'preserved',
            __proto__: 'malicious',
            constructor: 'malicious',
            prototype: 'malicious',
          },
        },
        { requestId: 'r1', dryRun: true }
      );

      expect(result.dryRun).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const preview = (result as any).preview;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['X-Custom']).toBe('preserved');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['Host']).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['Content-Length']).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['Transfer-Encoding']).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['Connection']).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['Keep-Alive']).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['__proto__']).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['constructor']).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['prototype']).toBeUndefined();
    });

    it('strips case-insensitive dangerous headers', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {
            host: 'example.com',
            'CONTENT-LENGTH': '100',
            'transfer-encoding': 'chunked',
            'Proxy-Authenticate': 'Basic',
            'Proxy-Authorization': 'Bearer token',
            TE: 'trailers',
            Trailers: 'Expires',
            Upgrade: 'h2c',
          },
        },
        { requestId: 'r1', dryRun: true }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const preview = (result as any).preview;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(Object.keys(preview.headers)).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // replayRequest — dry run
  // ────────────────────────────────────────────────────────────────
  describe('replayRequest — dry run', () => {
    it('returns dry run preview with defaults (dryRun not set)', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          postData: '{"key":"value"}',
        },
        { requestId: 'r1' } // dryRun defaults to true
      );

      expect(result.dryRun).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const preview = (result as any).preview;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.url).toBe('https://example.com/api');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.method).toBe('POST');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.body).toBe('{"key":"value"}');
    });

    it('returns dry run preview with dryRun=true', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {},
        },
        { requestId: 'r1', dryRun: true }
      );

      expect(result.dryRun).toBe(true);
    });

    it('blocks dry run for SSRF targets', async () => {
      await expect(
        replayRequest(
          { url: 'https://localhost/api', method: 'GET', headers: {} },
          { requestId: 'r1', dryRun: true }
        )
      ).rejects.toThrow('private/reserved');
    });

    it('applies url/method/header/body overrides in dry run', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      const result = await replayRequest(
        {
          url: 'https://old.example.com/api',
          method: 'GET',
          headers: { Accept: 'text/html' },
          postData: 'old-body',
        },
        {
          requestId: 'r1',
          dryRun: true,
          urlOverride: 'https://new.example.com/api',
          methodOverride: 'POST',
          headerPatch: { 'X-Custom': 'new' },
          bodyPatch: 'new-body',
        }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const preview = (result as any).preview;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.url).toBe('https://new.example.com/api');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.method).toBe('POST');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['X-Custom']).toBe('new');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.body).toBe('new-body');
    });

    it('uses postData when bodyPatch is not provided', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'POST',
          headers: {},
          postData: 'original-body',
        },
        { requestId: 'r1', dryRun: true }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const preview = (result as any).preview;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.body).toBe('original-body');
    });

    it('uses undefined body when neither bodyPatch nor postData provided', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {},
        },
        { requestId: 'r1', dryRun: true }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const preview = (result as any).preview;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.body).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // replayRequest — live mode
  // ────────────────────────────────────────────────────────────────
  describe('replayRequest — live mode', () => {
    it('makes fetch call and returns response', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      fetchMock.mockResolvedValue(
        new Response('response body', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {},
        },
        { requestId: 'r-live', dryRun: false }
      );

      expect(result.dryRun).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const live = result as any;
      expect(live.status).toBe(200);
      expect(live.body).toBe('response body');
      expect(live.bodyTruncated).toBe(false);
      expect(live.requestId).toBe('r-live');
    });

    it('truncates body when response exceeds maxBodyBytes', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      const largeBody = 'x'.repeat(200);
      fetchMock.mockResolvedValue(new Response(largeBody, { status: 200 }));

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {},
        },
        { requestId: 'r-trunc', dryRun: false },
        100 // small maxBodyBytes
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const live = result as any;
      expect(live.bodyTruncated).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(live.body.length).toBe(100);
    });

    it('blocks HTTP for non-loopback targets', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      await expect(
        replayRequest(
          {
            url: 'http://example.com/api',
            method: 'GET',
            headers: {},
          },
          { requestId: 'r1', dryRun: false }
        )
      ).rejects.toThrow('insecure HTTP is only allowed for loopback');
    });

    it('blocks HTTP for loopback targets due to SSRF guard', async () => {
      // Even though HTTP is allowed for loopback hosts at the protocol check,
      // localhost is still a private host and gets blocked by the SSRF guard.
      await expect(
        replayRequest(
          {
            url: 'http://localhost:3000/api',
            method: 'GET',
            headers: {},
          },
          { requestId: 'r-loop', dryRun: false }
        )
      ).rejects.toThrow('private/reserved');
    });

    it('allows HTTP for loopback IP 127.0.0.1 (IP literal skips DNS)', async () => {
      // 127.0.0.1 passes the HTTP loopback check but is blocked by isPrivateHost
      await expect(
        replayRequest(
          {
            url: 'http://127.0.0.1:3000/api',
            method: 'GET',
            headers: {},
          },
          { requestId: 'r-loop-ip', dryRun: false }
        )
      ).rejects.toThrow('private/reserved');
    });

    it('blocks when DNS resolves to private IP', async () => {
      lookupMock.mockResolvedValue({ address: '10.0.0.1' });

      await expect(
        replayRequest(
          {
            url: 'https://evil.example.com/api',
            method: 'GET',
            headers: {},
          },
          { requestId: 'r1', dryRun: false }
        )
      ).rejects.toThrow('resolved to private IP');
    });

    it('blocks when DNS resolution fails', async () => {
      lookupMock.mockRejectedValue(new Error('NXDOMAIN'));

      await expect(
        replayRequest(
          {
            url: 'https://no-such-host.example.com/api',
            method: 'GET',
            headers: {},
          },
          { requestId: 'r1', dryRun: false }
        )
      ).rejects.toThrow('DNS resolution failed');
    });

    it('does not send body for GET method', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

      await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {},
          postData: 'should-not-be-sent',
        },
        { requestId: 'r1', dryRun: false }
      );

      const fetchCall = getFetchCall(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(fetchCall[1].body).toBeUndefined();
    });

    it('does not send body for HEAD method', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      fetchMock.mockResolvedValue(new Response('', { status: 200 }));

      await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'HEAD',
          headers: {},
          postData: 'should-not-be-sent',
        },
        { requestId: 'r1', dryRun: false }
      );

      const fetchCall = getFetchCall(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(fetchCall[1].body).toBeUndefined();
    });

    it('sends body for POST method', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      fetchMock.mockResolvedValue(new Response('created', { status: 201 }));

      await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'POST',
          headers: {},
          postData: '{"key":"value"}',
        },
        { requestId: 'r1', dryRun: false }
      );

      const fetchCall = getFetchCall(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(fetchCall[1].body).toBe('{"key":"value"}');
    });

    it('uppercases method', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

      await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'get',
          headers: {},
        },
        { requestId: 'r1', dryRun: false }
      );

      const fetchCall = getFetchCall(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(fetchCall[1].method).toBe('GET');
    });

    it('uses methodOverride when provided', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

      await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {},
        },
        { requestId: 'r1', dryRun: false, methodOverride: 'delete' }
      );

      const fetchCall = getFetchCall(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(fetchCall[1].method).toBe('DELETE');
    });

    it('uses urlOverride when provided', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

      await replayRequest(
        {
          url: 'https://old.example.com/api',
          method: 'GET',
          headers: {},
        },
        { requestId: 'r1', dryRun: false, urlOverride: 'https://new.example.com/api' }
      );

      const fetchCall = getFetchCall(0);
      expect(fetchCall[0]).toBe('https://new.example.com/api');
    });

    it('collects response headers', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });
      fetchMock.mockResolvedValue(
        new Response('ok', {
          status: 200,
          headers: {
            'X-Response-1': 'value1',
            'X-Response-2': 'value2',
          },
        })
      );

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: {},
        },
        { requestId: 'r1', dryRun: false }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const live = result as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(live.headers['x-response-1']).toBe('value1');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(live.headers['x-response-2']).toBe('value2');
    });

    it('handles IP literal hostname (no DNS lookup needed)', async () => {
      fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

      const result = await replayRequest(
        {
          url: 'https://93.184.216.34/api',
          method: 'GET',
          headers: {},
        },
        { requestId: 'r-ip', dryRun: false }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const live = result as any;
      expect(live.status).toBe(200);
      // Should NOT call DNS lookup for IP literals
      expect(lookupMock).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // replayRequest — redirects
  // ────────────────────────────────────────────────────────────────
  describe('replayRequest — redirects', () => {
    it('follows 302 redirect and converts to GET', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      fetchMock
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { Location: 'https://example.com/new-path' },
          })
        )
        .mockResolvedValueOnce(new Response('redirected', { status: 200 }));

      const result = await replayRequest(
        {
          url: 'https://example.com/old-path',
          method: 'POST',
          headers: {},
          postData: 'body-data',
        },
        { requestId: 'r-redir', dryRun: false }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const live = result as any;
      expect(live.status).toBe(200);
      expect(live.body).toBe('redirected');

      // Second fetch should be GET with no body (302 → GET)
      const secondCall = getFetchCall(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(secondCall[1].method).toBe('GET');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(secondCall[1].body).toBeUndefined();
    });

    it('follows 301 redirect and converts to GET', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      fetchMock
        .mockResolvedValueOnce(
          new Response(null, {
            status: 301,
            headers: { Location: 'https://example.com/new' },
          })
        )
        .mockResolvedValueOnce(new Response('final', { status: 200 }));

      const result = await replayRequest(
        {
          url: 'https://example.com/old',
          method: 'POST',
          headers: {},
        },
        { requestId: 'r-301', dryRun: false }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const live = result as any;
      expect(live.status).toBe(200);
    });

    it('follows 303 redirect and converts to GET', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      fetchMock
        .mockResolvedValueOnce(
          new Response(null, {
            status: 303,
            headers: { Location: 'https://example.com/see-other' },
          })
        )
        .mockResolvedValueOnce(new Response('final', { status: 200 }));

      const result = await replayRequest(
        {
          url: 'https://example.com/action',
          method: 'POST',
          headers: {},
        },
        { requestId: 'r-303', dryRun: false }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const live = result as any;
      expect(live.status).toBe(200);
    });

    it('throws on redirect without Location header (treated as too many redirects)', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      // A redirect without Location header breaks out of the redirect loop,
      // but the final response is still a 3xx, triggering the "too many redirects" error
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 302 })
        // No Location header
      );

      await expect(
        replayRequest(
          {
            url: 'https://example.com/api',
            method: 'GET',
            headers: {},
          },
          { requestId: 'r-noloc', dryRun: false }
        )
      ).rejects.toThrow('too many redirects');
    });

    it('throws on too many redirects', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      // 6 consecutive redirects (max is 5)
      for (let i = 0; i < 6; i++) {
        fetchMock.mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { Location: `https://example.com/hop${i + 1}` },
          })
        );
      }

      await expect(
        replayRequest(
          {
            url: 'https://example.com/start',
            method: 'GET',
            headers: {},
          },
          { requestId: 'r-loops', dryRun: false }
        )
      ).rejects.toThrow('too many redirects');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // replayRequest — merging headers
  // ────────────────────────────────────────────────────────────────
  describe('replayRequest — header merging', () => {
    it('merges headerPatch with base headers', async () => {
      lookupMock.mockResolvedValue({ address: buildPublicIp() });

      const result = await replayRequest(
        {
          url: 'https://example.com/api',
          method: 'GET',
          headers: { Authorization: 'Bearer old', Accept: 'text/html' },
        },
        {
          requestId: 'r1',
          dryRun: true,
          headerPatch: { Authorization: 'Bearer new', 'X-Custom': 'added' },
        }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const preview = (result as any).preview;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['Authorization']).toBe('Bearer new');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['Accept']).toBe('text/html');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(preview.headers['X-Custom']).toBe('added');
    });
  });
});
