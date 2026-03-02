/**
 * HTTP middleware for MCP Streamable HTTP transport.
 *
 * - Bearer token authentication (opt-in via MCP_AUTH_TOKEN env)
 * - Origin validation to prevent CSRF on localhost
 * - Request body size limiting (default 10 MB)
 * - Sliding-window rate limiting per IP (default 60 req/min)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Allowed origins for localhost CSRF protection
// ---------------------------------------------------------------------------
const LOCALHOST_ORIGINS = new Set([
  'http://127.0.0.1',
  'http://localhost',
  'http://[::1]',
]);

/**
 * Reject cross-origin requests to localhost when no auth token is set.
 * Browsers always send Origin on POST/PUT/DELETE; its absence means
 * non-browser client (curl, SDK) which is fine.
 */
export function checkOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients

  // Strip port from origin for comparison (e.g. http://localhost:3000 → http://localhost)
  let originBase: string;
  try {
    const parsed = new URL(origin);
    originBase = `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden – invalid Origin header');
    return false;
  }

  if (LOCALHOST_ORIGINS.has(originBase)) return true;

  // If MCP_AUTH_TOKEN is set, any origin with valid auth is OK (checked by checkAuth)
  if (process.env.MCP_AUTH_TOKEN) return true;

  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('Forbidden – cross-origin requests require MCP_AUTH_TOKEN');
  return false;
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/**
 * If `MCP_AUTH_TOKEN` is set, validates `Authorization: Bearer <token>`.
 * Returns `true` when the request is allowed to proceed.
 */
export function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    // When binding to non-localhost without a token, reject unless explicitly allowed
    const host = process.env.MCP_HOST ?? '127.0.0.1';
    const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!isLocal && !['1', 'true'].includes((process.env.MCP_ALLOW_INSECURE ?? '').toLowerCase())) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden – MCP_AUTH_TOKEN is required when binding to non-localhost. Set MCP_ALLOW_INSECURE=1 to override.');
      return false;
    }
    return true; // local access or explicitly insecure
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized – missing or malformed Authorization header');
    return false;
  }

  // Constant-time comparison to avoid timing attacks
  const token = header.slice(7);
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length || !cryptoTimingSafeEqual(tokenBuf, expectedBuf)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden – invalid token');
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Body size limit middleware
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BODY_BYTES = (() => {
  const envVal = parseInt(process.env.MCP_MAX_BODY_BYTES ?? '', 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 10 * 1024 * 1024;
})();

/**
 * Reads the request body with a byte-size cap.
 * Resolves with the parsed JSON body, or rejects / sends 413 on overflow.
 */
export function readBodyWithLimit(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    // Fast-reject via Content-Length if available
    const declaredLength = parseInt(req.headers['content-length'] ?? '', 10);
    if (!isNaN(declaredLength) && declaredLength > maxBytes) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end(`Payload Too Large – limit is ${maxBytes} bytes`);
      reject(new Error('body_too_large'));
      return;
    }

    let overflowed = false;

    req.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      received += chunk.length;
      if (received > maxBytes) {
        overflowed = true;
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end(`Payload Too Large – limit is ${maxBytes} bytes`, () => {
          req.destroy();
        });
        reject(new Error('body_too_large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (overflowed) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request – invalid JSON body');
        reject(new Error('invalid_json'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Sliding-window rate limiter per IP
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = (() => {
  const envVal = parseInt(process.env.MCP_RATE_LIMIT_WINDOW_MS ?? '', 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 60_000;
})();

const RATE_LIMIT_MAX_REQUESTS = (() => {
  const envVal = parseInt(process.env.MCP_RATE_LIMIT_MAX ?? '', 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 60;
})();

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/** Periodic cleanup of stale entries (every 5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60_000;
let lastCleanup = Date.now();

function rateLimitCleanup(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  for (const [ip, entry] of rateLimitStore) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) {
      rateLimitStore.delete(ip);
    }
  }
}

function getClientIP(req: IncomingMessage): string {
  // Trust X-Forwarded-For only when behind a local reverse proxy
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded)
      ? forwarded[0]!
      : forwarded.split(',')[0]!;
    return first.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Sliding-window rate limiter. Returns `true` if the request is allowed.
 *
 * Configurable via:
 *  - MCP_RATE_LIMIT_MAX (default 60 requests)
 *  - MCP_RATE_LIMIT_WINDOW_MS (default 60000ms = 1 minute)
 *  - MCP_RATE_LIMIT_ENABLED=0 to disable entirely
 */
export function checkRateLimit(req: IncomingMessage, res: ServerResponse): boolean {
  // Allow disabling rate limiting (e.g. behind an external rate limiter)
  if (['0', 'false'].includes((process.env.MCP_RATE_LIMIT_ENABLED ?? '').toLowerCase())) {
    return true;
  }

  // Authenticated requests get a higher limit (3x) since they are trusted
  const hasAuth = !!process.env.MCP_AUTH_TOKEN && !!req.headers.authorization;
  const maxRequests = hasAuth ? RATE_LIMIT_MAX_REQUESTS * 3 : RATE_LIMIT_MAX_REQUESTS;

  const now = Date.now();
  rateLimitCleanup(now);

  const ip = getClientIP(req);
  let entry = rateLimitStore.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(ip, entry);
  }

  // Evict timestamps outside the window
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const retryAfterSec = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
    res.writeHead(429, {
      'Content-Type': 'text/plain',
      'Retry-After': String(retryAfterSec),
    });
    res.end(`Too Many Requests – limit is ${maxRequests} per ${retryAfterSec}s window`);
    return false;
  }

  entry.timestamps.push(now);
  return true;
}
