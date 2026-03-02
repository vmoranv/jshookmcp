import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkOrigin, checkAuth, checkRateLimit, readBodyWithLimit } from '../../../src/server/http/HttpMiddleware.js';

/* ---------- mock helpers ---------- */

function mockReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & { _status?: number; _body?: string } {
  const res: Record<string, unknown> = {
    _status: undefined,
    _body: undefined,
    writeHead(status: number) {
      res._status = status;
      return res;
    },
    end(body?: string, cb?: () => void) {
      res._body = body;
      if (typeof cb === 'function') cb();
      return res;
    },
  };
  return res as unknown as ServerResponse & { _status?: number; _body?: string };
}

/* ---------- tests ---------- */

describe('HttpMiddleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MCP_AUTH_TOKEN;
    delete process.env.MCP_HOST;
    delete process.env.MCP_ALLOW_INSECURE;
    delete process.env.MCP_RATE_LIMIT_ENABLED;
    delete process.env.MCP_RATE_LIMIT_MAX;
    delete process.env.MCP_RATE_LIMIT_WINDOW_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('checkOrigin', () => {
    it('allows requests without Origin header (non-browser)', () => {
      const req = mockReq({ headers: {} });
      const res = mockRes();
      expect(checkOrigin(req, res)).toBe(true);
    });

    it('allows localhost origins', () => {
      for (const origin of ['http://127.0.0.1:3000', 'http://localhost:8080', 'http://[::1]:9090']) {
        const req = mockReq({ headers: { origin } });
        const res = mockRes();
        expect(checkOrigin(req, res)).toBe(true);
      }
    });

    it('rejects non-localhost origin when no auth token', () => {
      const req = mockReq({ headers: { origin: 'http://evil.com' } });
      const res = mockRes();
      expect(checkOrigin(req, res)).toBe(false);
      expect(res._status).toBe(403);
    });

    it('allows non-localhost origin when auth token is set', () => {
      process.env.MCP_AUTH_TOKEN = 'secret';
      const req = mockReq({ headers: { origin: 'http://remote.com' } });
      const res = mockRes();
      expect(checkOrigin(req, res)).toBe(true);
    });

    it('rejects malformed Origin header', () => {
      const req = mockReq({ headers: { origin: 'not-a-url' } });
      const res = mockRes();
      expect(checkOrigin(req, res)).toBe(false);
      expect(res._status).toBe(403);
    });
  });

  describe('checkAuth', () => {
    it('allows requests when no auth token configured (localhost)', () => {
      process.env.MCP_HOST = '127.0.0.1';
      const req = mockReq();
      const res = mockRes();
      expect(checkAuth(req, res)).toBe(true);
    });

    it('rejects non-local binding without token or insecure flag', () => {
      process.env.MCP_HOST = '0.0.0.0';
      const req = mockReq();
      const res = mockRes();
      expect(checkAuth(req, res)).toBe(false);
      expect(res._status).toBe(403);
    });

    it('allows non-local binding with MCP_ALLOW_INSECURE=1', () => {
      process.env.MCP_HOST = '0.0.0.0';
      process.env.MCP_ALLOW_INSECURE = '1';
      const req = mockReq();
      const res = mockRes();
      expect(checkAuth(req, res)).toBe(true);
    });

    it('validates correct bearer token', () => {
      process.env.MCP_AUTH_TOKEN = 'mysecret';
      const req = mockReq({
        headers: { authorization: 'Bearer mysecret' },
      });
      const res = mockRes();
      expect(checkAuth(req, res)).toBe(true);
    });

    it('rejects wrong bearer token', () => {
      process.env.MCP_AUTH_TOKEN = 'mysecret';
      const req = mockReq({
        headers: { authorization: 'Bearer wrongtoken' },
      });
      const res = mockRes();
      expect(checkAuth(req, res)).toBe(false);
      expect(res._status).toBe(403);
    });

    it('rejects missing authorization header', () => {
      process.env.MCP_AUTH_TOKEN = 'mysecret';
      const req = mockReq({ headers: {} });
      const res = mockRes();
      expect(checkAuth(req, res)).toBe(false);
      expect(res._status).toBe(401);
    });

    it('rejects non-Bearer authorization scheme', () => {
      process.env.MCP_AUTH_TOKEN = 'mysecret';
      const req = mockReq({
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      const res = mockRes();
      expect(checkAuth(req, res)).toBe(false);
      expect(res._status).toBe(401);
    });
  });

  describe('checkRateLimit', () => {
    it('allows requests when rate limiting is disabled', () => {
      process.env.MCP_RATE_LIMIT_ENABLED = '0';
      const req = mockReq();
      const res = mockRes();
      expect(checkRateLimit(req, res)).toBe(true);
    });

    it('allows requests within limit', () => {
      const req = mockReq();
      const res = mockRes();
      // Default limit is 60/min, a single request should pass
      expect(checkRateLimit(req, res)).toBe(true);
    });
  });

  describe('readBodyWithLimit', () => {
    it('rejects oversized Content-Length upfront', async () => {
      const req = mockReq({
        headers: { 'content-length': '999999999' },
      });
      // Add EventEmitter-like methods
      (req as Record<string, unknown>).on = vi.fn();
      const res = mockRes();

      await expect(readBodyWithLimit(req, res, 1024)).rejects.toThrow('body_too_large');
      expect(res._status).toBe(413);
    });
  });
});
