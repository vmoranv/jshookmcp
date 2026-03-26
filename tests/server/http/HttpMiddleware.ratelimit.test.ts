import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

function mockReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    headers: {},
    socket: { remoteAddress: '10.0.0.1' },
    ...overrides,
  } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & {
  _status?: number;
  _body?: string;
  _headers?: Record<string, string>;
} {
  const res: Record<string, unknown> = {
    _status: undefined,
    _body: undefined,
    _headers: {},
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) res._headers = headers;
      return res;
    },
    end(body?: string, cb?: () => void) {
      res._body = body;
      if (typeof cb === 'function') cb();
      return res;
    },
  };
  return res as unknown as ServerResponse & {
    _status?: number;
    _body?: string;
    _headers?: Record<string, string>;
  };
}

describe('HttpMiddleware rate-limit and proxy tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Set a very low rate limit for testing
    process.env.MCP_RATE_LIMIT_MAX = '3';
    process.env.MCP_RATE_LIMIT_WINDOW_MS = '60000';
    delete process.env.MCP_RATE_LIMIT_ENABLED;
    delete process.env.MCP_TRUST_PROXY;
    delete process.env.MCP_AUTH_TOKEN;
    delete process.env.MCP_HOST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const { checkRateLimit } = await import('@server/http/HttpMiddleware');

    // Use unique IP per request (same IP in this test)
    const ip = '192.168.1.100';

    // First 3 requests should pass (limit = 3)
    for (let i = 0; i < 3; i++) {
      const req = mockReq({ socket: { remoteAddress: ip } } as any);
      const res = mockRes();
      expect(checkRateLimit(req, res)).toBe(true);
    }

    // 4th request should be rate limited
    const req = mockReq({ socket: { remoteAddress: ip } } as any);
    const res = mockRes();
    expect(checkRateLimit(req, res)).toBe(false);
    expect(res._status).toBe(429);
    expect(res._body).toContain('Too Many Requests');
    expect((res._headers as any)?.['Retry-After']).toBeDefined();
  });

  it('authenticated users get 3x rate limit', async () => {
    const { checkRateLimit } = await import('@server/http/HttpMiddleware');
    const ip = '192.168.1.200';

    // Authenticated limit = 3 * 3 = 9
    for (let i = 0; i < 9; i++) {
      const req = mockReq({ socket: { remoteAddress: ip } } as any);
      const res = mockRes();
      expect(checkRateLimit(req, res, true)).toBe(true);
    }

    // 10th request should be rate limited
    const req = mockReq({ socket: { remoteAddress: ip } } as any);
    const res = mockRes();
    expect(checkRateLimit(req, res, true)).toBe(false);
    expect(res._status).toBe(429);
  });

  it('uses X-Forwarded-For when MCP_TRUST_PROXY is set', async () => {
    process.env.MCP_TRUST_PROXY = 'true';
    const { checkRateLimit } = await import('@server/http/HttpMiddleware');

    // Requests from different XFF IPs should each have their own limit
    for (let i = 0; i < 3; i++) {
      const req = mockReq({
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
        socket: { remoteAddress: '127.0.0.1' },
      } as any);
      const res = mockRes();
      expect(checkRateLimit(req, res)).toBe(true);
    }

    // 4th request from same XFF IP should be limited
    const req = mockReq({
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any);
    const res = mockRes();
    expect(checkRateLimit(req, res)).toBe(false);
    expect(res._status).toBe(429);
  });

  it('ignores X-Forwarded-For when MCP_TRUST_PROXY is not set', async () => {
    const { checkRateLimit } = await import('@server/http/HttpMiddleware');

    // Without trust proxy, XFF header should be ignored
    // All requests should use socket.remoteAddress
    const ip = '10.0.0.50';
    for (let i = 0; i < 3; i++) {
      const req = mockReq({
        headers: { 'x-forwarded-for': 'different-ip-' + i },
        socket: { remoteAddress: ip },
      } as any);
      const res = mockRes();
      expect(checkRateLimit(req, res)).toBe(true);
    }

    // 4th request same socket IP → limited, despite different XFF
    const req = mockReq({
      headers: { 'x-forwarded-for': 'another-unique-ip' },
      socket: { remoteAddress: ip },
    } as any);
    const res = mockRes();
    expect(checkRateLimit(req, res)).toBe(false);
    expect(res._status).toBe(429);
  });

  it('uses X-Forwarded-For array format', async () => {
    process.env.MCP_TRUST_PROXY = '1';
    const { checkRateLimit } = await import('@server/http/HttpMiddleware');

    // Array-style XFF header
    const req = mockReq({
      headers: { 'x-forwarded-for': ['9.9.9.9', '8.8.8.8'] },
      socket: { remoteAddress: '127.0.0.1' },
    } as any);
    const res = mockRes();
    expect(checkRateLimit(req, res)).toBe(true);
  });

  it('falls back to socket.remoteAddress when unknown', async () => {
    const { checkRateLimit } = await import('@server/http/HttpMiddleware');
    const req = mockReq({
      socket: { remoteAddress: undefined },
    } as any);
    const res = mockRes();
    expect(checkRateLimit(req, res)).toBe(true);
  });

  it('different IPs have independent rate limits', async () => {
    const { checkRateLimit } = await import('@server/http/HttpMiddleware');

    // Exhaust IP-A's limit
    for (let i = 0; i < 3; i++) {
      const req = mockReq({ socket: { remoteAddress: '10.0.0.1' } } as any);
      const res = mockRes();
      checkRateLimit(req, res);
    }

    // IP-B should still be allowed
    const req = mockReq({ socket: { remoteAddress: '10.0.0.2' } } as any);
    const res = mockRes();
    expect(checkRateLimit(req, res)).toBe(true);
  });
});
