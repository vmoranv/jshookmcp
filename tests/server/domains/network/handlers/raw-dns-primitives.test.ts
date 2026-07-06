import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dnsResolve: vi.fn(),
  dnsReverse: vi.fn(),
  resolverResolve: vi.fn(),
  resolverReverse: vi.fn(),
  resolverSetServers: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  resolve: (...args: unknown[]) => state.dnsResolve(...args),
  reverse: (...args: unknown[]) => state.dnsReverse(...args),
  Resolver: vi.fn(function Resolver() {
    return {
      resolve: (...args: unknown[]) => state.resolverResolve(...args),
      reverse: (...args: unknown[]) => state.resolverReverse(...args),
      setServers: (...args: unknown[]) => state.resolverSetServers(...args),
    };
  }),
}));

import { RawDnsHttpHandlers } from '@server/domains/network/handlers/raw-dns-http-handlers';

function parseJson(response: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  return JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;
}

interface ChainEntry {
  host: string;
  target: string | null;
  status: string;
  depth: number;
  timing: number;
}

interface BulkEntry {
  hostname: string;
  status: string;
  records: unknown;
  timing: number;
}

function getChain(response: { content: Array<{ type: string; text?: string }> }): ChainEntry[] {
  const json = parseJson(response);
  return (json.chain ?? []) as ChainEntry[];
}

function getResults(response: { content: Array<{ type: string; text?: string }> }): BulkEntry[] {
  const json = parseJson(response);
  return (json.results ?? []) as BulkEntry[];
}

function parseText(response: {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}) {
  return { text: response.content[0]?.text ?? '', isError: response.isError ?? false };
}

function dnsError(code: string, hostname: string) {
  const err = new Error(`queryA ${code} ${hostname}`);
  Object.assign(err, { code, hostname, syscall: 'queryA' });
  return err;
}

describe('RawDnsHttpHandlers — DNS primitives', () => {
  let handler: RawDnsHttpHandlers;

  beforeAll(() => {
    handler = new RawDnsHttpHandlers(undefined);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── dns_probe ──

  describe('handleDnsProbe', () => {
    it('returns NOERROR with records on successful resolve', async () => {
      state.dnsResolve.mockResolvedValue(['1.2.3.4']);
      const res = await handler.handleDnsProbe({ hostname: 'example.com', rrType: 'A' });
      const json = parseJson(res);
      expect(json.success).toBe(true);
      expect(json.status).toBe('NOERROR');
      expect(json.records).toEqual(['1.2.3.4']);
      expect(json.rrType).toBe('A');
      expect(json.timing).toBeTypeOf('number');
    });

    it('returns NXDOMAIN status for ENOTFOUND', async () => {
      state.dnsResolve.mockRejectedValue(dnsError('ENOTFOUND', 'dead.example.com'));
      const res = await handler.handleDnsProbe({ hostname: 'dead.example.com' });
      const json = parseJson(res);
      expect(json.success).toBe(true);
      expect(json.status).toBe('NXDOMAIN');
      expect(json.records).toEqual([]);
      expect(json.errorCode).toBe('ENOTFOUND');
    });

    it('returns NODATA status for ENODATA', async () => {
      state.dnsResolve.mockRejectedValue(dnsError('ENODATA', 'example.com'));
      const res = await handler.handleDnsProbe({ hostname: 'example.com', rrType: 'CNAME' });
      const json = parseJson(res);
      expect(json.success).toBe(true);
      expect(json.status).toBe('NODATA');
      expect(json.records).toEqual([]);
      expect(json.errorCode).toBe('ENODATA');
    });

    it('returns SERVFAIL status', async () => {
      state.dnsResolve.mockRejectedValue(dnsError('ESERVFAIL', 'example.com'));
      const res = await handler.handleDnsProbe({ hostname: 'example.com' });
      const json = parseJson(res);
      expect(json.status).toBe('SERVFAIL');
    });

    it('returns TIMEOUT status', async () => {
      state.dnsResolve.mockRejectedValue(dnsError('ETIMEOUT', 'slow.example.com'));
      const res = await handler.handleDnsProbe({ hostname: 'slow.example.com' });
      const json = parseJson(res);
      expect(json.status).toBe('TIMEOUT');
    });

    it('returns CONNREFUSED status', async () => {
      state.dnsResolve.mockRejectedValue(dnsError('ECONNREFUSED', 'example.com'));
      const res = await handler.handleDnsProbe({ hostname: 'example.com' });
      const json = parseJson(res);
      expect(json.status).toBe('CONNREFUSED');
    });

    it('returns REFUSED status', async () => {
      state.dnsResolve.mockRejectedValue(dnsError('EREFUSED', 'example.com'));
      const res = await handler.handleDnsProbe({ hostname: 'example.com' });
      const json = parseJson(res);
      expect(json.status).toBe('REFUSED');
    });

    it('returns ERROR for unknown error codes', async () => {
      state.dnsResolve.mockRejectedValue(dnsError('EBADRESP', 'example.com'));
      const res = await handler.handleDnsProbe({ hostname: 'example.com' });
      const json = parseJson(res);
      expect(json.status).toBe('ERROR');
    });

    it('requires hostname', async () => {
      const res = await handler.handleDnsProbe({});
      const { text, isError } = parseText(res);
      expect(isError).toBe(true);
      expect(text).toContain('hostname is required');
    });

    it('rejects invalid rrType', async () => {
      const res = await handler.handleDnsProbe({ hostname: 'example.com', rrType: 'INVALID' });
      const { text, isError } = parseText(res);
      expect(isError).toBe(true);
      expect(text).toContain('Invalid rrType');
    });

    it('defaults rrType to A', async () => {
      state.dnsResolve.mockResolvedValue(['1.2.3.4']);
      await handler.handleDnsProbe({ hostname: 'example.com' });
      expect(state.dnsResolve).toHaveBeenCalledWith('example.com', 'A');
    });

    it('uses an explicit resolver server when provided', async () => {
      state.resolverResolve.mockResolvedValue(['9.9.9.9']);
      const res = await handler.handleDnsProbe({
        hostname: 'example.com',
        rrType: 'A',
        server: '9.9.9.9',
      });
      const json = parseJson(res);

      expect(json.success).toBe(true);
      expect(json.server).toBe('9.9.9.9');
      expect(json.records).toEqual(['9.9.9.9']);
      expect(state.resolverSetServers).toHaveBeenCalledWith(['9.9.9.9']);
      expect(state.resolverResolve).toHaveBeenCalledWith('example.com', 'A');
      expect(state.dnsResolve).not.toHaveBeenCalled();
    });
  });

  // ── dns_cname_chain ──

  describe('handleDnsCnameChain', () => {
    it('traces a full CNAME chain', async () => {
      state.dnsResolve
        .mockResolvedValueOnce(['cdn.example.com'])
        .mockResolvedValueOnce(['cdn.cloudflare.com'])
        .mockRejectedValueOnce(dnsError('ENOTFOUND', 'cdn.cloudflare.com'));

      const res = await handler.handleDnsCnameChain({ hostname: 'www.example.com' });
      const json = parseJson(res);
      expect(json.success).toBe(true);
      expect(getChain(res)).toEqual([
        {
          host: 'www.example.com',
          target: 'cdn.example.com',
          status: 'CNAME',
          depth: 0,
          timing: expect.any(Number),
        },
        {
          host: 'cdn.example.com',
          target: 'cdn.cloudflare.com',
          status: 'CNAME',
          depth: 1,
          timing: expect.any(Number),
        },
        {
          host: 'cdn.cloudflare.com',
          target: null,
          status: 'TERMINAL',
          depth: 2,
          timing: expect.any(Number),
        },
      ]);
      expect(json.depth).toBe(3);
    });

    it('returns single TERMINAL entry when hostname has no CNAME', async () => {
      state.dnsResolve.mockRejectedValueOnce(dnsError('ENOTFOUND', 'direct.example.com'));

      const res = await handler.handleDnsCnameChain({ hostname: 'direct.example.com' });
      const chain = getChain(res);
      expect(chain).toHaveLength(1);
      expect(chain[0]!.status).toBe('TERMINAL');
      expect(chain[0]!.target).toBeNull();
    });

    it('respects maxDepth parameter', async () => {
      state.dnsResolve.mockImplementation((host: string) => Promise.resolve([`next.${host}`]));

      const res = await handler.handleDnsCnameChain({
        hostname: 'a.example.com',
        maxDepth: 3,
      });
      const json = parseJson(res);
      expect(json.depth).toBe(3);
    });

    it('reports SERVFAIL in chain', async () => {
      state.dnsResolve
        .mockResolvedValueOnce(['broken.example.com'])
        .mockRejectedValueOnce(dnsError('ESERVFAIL', 'broken.example.com'));

      const res = await handler.handleDnsCnameChain({ hostname: 'www.example.com' });
      const chain = getChain(res);
      expect(chain[1]!.status).toBe('SERVFAIL');
    });

    it('requires hostname', async () => {
      const res = await handler.handleDnsCnameChain({});
      const { text, isError } = parseText(res);
      expect(isError).toBe(true);
      expect(text).toContain('hostname is required');
    });

    it('stops chain when CNAME resolves to null target', async () => {
      state.dnsResolve.mockResolvedValueOnce([null as unknown as string]);

      const res = await handler.handleDnsCnameChain({ hostname: 'example.com' });
      const json = parseJson(res);
      const chain = getChain(res);
      expect(json.depth).toBe(1);
      expect(chain[0]!.target).toBeNull();
    });

    it('uses an explicit resolver server for every CNAME hop', async () => {
      state.resolverResolve
        .mockResolvedValueOnce(['cdn.example.com'])
        .mockRejectedValueOnce(dnsError('ENODATA', 'cdn.example.com'));

      const res = await handler.handleDnsCnameChain({
        hostname: 'www.example.com',
        server: '1.1.1.1',
      });
      const json = parseJson(res);

      expect(json.server).toBe('1.1.1.1');
      expect(state.resolverSetServers).toHaveBeenCalledWith(['1.1.1.1']);
      expect(state.resolverResolve).toHaveBeenNthCalledWith(1, 'www.example.com', 'CNAME');
      expect(state.resolverResolve).toHaveBeenNthCalledWith(2, 'cdn.example.com', 'CNAME');
    });
  });

  // ── dns_bulk_resolve ──

  describe('handleDnsBulkResolve', () => {
    it('resolves multiple hostnames concurrently', async () => {
      state.dnsResolve
        .mockResolvedValueOnce(['1.1.1.1'])
        .mockRejectedValueOnce(dnsError('ENOTFOUND', 'dead.example.com'))
        .mockResolvedValueOnce(['3.3.3.3']);

      const res = await handler.handleDnsBulkResolve({
        hostnames: ['a.example.com', 'dead.example.com', 'c.example.com'],
      });
      const json = parseJson(res);
      expect(json.success).toBe(true);
      expect(json.total).toBe(3);
      expect(json.errors).toBe(1);
      const results = getResults(res);
      expect(results[0]).toEqual({
        hostname: 'a.example.com',
        status: 'NOERROR',
        records: ['1.1.1.1'],
        timing: expect.any(Number),
      });
      expect(results[1]).toEqual({
        hostname: 'dead.example.com',
        status: 'NXDOMAIN',
        records: [],
        timing: expect.any(Number),
      });
      expect(results[2]).toEqual({
        hostname: 'c.example.com',
        status: 'NOERROR',
        records: ['3.3.3.3'],
        timing: expect.any(Number),
      });
    });

    it('keeps ENODATA distinct from NXDOMAIN in bulk results', async () => {
      state.dnsResolve
        .mockRejectedValueOnce(dnsError('ENODATA', 'example.com'))
        .mockRejectedValueOnce(dnsError('ENOTFOUND', 'dead.example.com'));

      const res = await handler.handleDnsBulkResolve({
        hostnames: ['example.com', 'dead.example.com'],
        rrType: 'CNAME',
      });

      const results = getResults(res);
      expect(results[0]!.status).toBe('NODATA');
      expect(results[1]!.status).toBe('NXDOMAIN');
    });

    it('returns structured errors for each failed hostname', async () => {
      state.dnsResolve
        .mockRejectedValueOnce(dnsError('ENOTFOUND', 'a.example.com'))
        .mockRejectedValueOnce(dnsError('ESERVFAIL', 'b.example.com'));

      const res = await handler.handleDnsBulkResolve({
        hostnames: ['a.example.com', 'b.example.com'],
      });
      const json = parseJson(res);
      const results = getResults(res);
      expect(results[0]!.status).toBe('NXDOMAIN');
      expect(results[1]!.status).toBe('SERVFAIL');
      expect(json.errors).toBe(2);
    });

    it('requires non-empty hostnames array', async () => {
      const res = await handler.handleDnsBulkResolve({ hostnames: [] });
      const { text, isError } = parseText(res);
      expect(isError).toBe(true);
      expect(text).toContain('non-empty');
    });

    it('rejects arrays larger than 1000', async () => {
      const res = await handler.handleDnsBulkResolve({
        hostnames: Array.from({ length: 1001 }, (_, i) => `${i}.example.com`),
      });
      const { text, isError } = parseText(res);
      expect(isError).toBe(true);
      expect(text).toContain('max 1000');
    });

    it('rejects invalid rrType', async () => {
      const res = await handler.handleDnsBulkResolve({
        hostnames: ['example.com'],
        rrType: 'BOGUS',
      });
      const { text, isError } = parseText(res);
      expect(isError).toBe(true);
      expect(text).toContain('Invalid rrType');
    });

    it('defaults rrType to A and concurrency to 10', async () => {
      state.dnsResolve.mockResolvedValue(['1.2.3.4']);
      await handler.handleDnsBulkResolve({ hostnames: ['example.com'] });
      expect(state.dnsResolve).toHaveBeenCalledWith('example.com', 'A');
    });

    it('handles MX record results', async () => {
      state.dnsResolve.mockResolvedValue([{ exchange: 'mail.example.com', priority: 10 }]);
      const res = await handler.handleDnsBulkResolve({
        hostnames: ['example.com'],
        rrType: 'MX',
      });
      const results = getResults(res);
      expect(results[0]!.status).toBe('NOERROR');
      expect(results[0]!.records).toEqual([{ exchange: 'mail.example.com', priority: 10 }]);
    });

    it('uses an explicit resolver server for bulk lookups', async () => {
      state.resolverResolve.mockResolvedValue(['4.4.4.4']);
      const res = await handler.handleDnsBulkResolve({
        hostnames: ['a.example.com', 'b.example.com'],
        server: '4.4.4.4',
      });
      const json = parseJson(res);

      expect(json.server).toBe('4.4.4.4');
      expect(state.resolverSetServers).toHaveBeenCalledWith(['4.4.4.4']);
      expect(state.resolverResolve).toHaveBeenCalledWith('a.example.com', 'A');
      expect(state.resolverResolve).toHaveBeenCalledWith('b.example.com', 'A');
    });
  });
});
