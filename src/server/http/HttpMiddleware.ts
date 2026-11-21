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
import { HTTP_CLEANUP_INTERVAL_MS, HTTP_RATE_LIMIT_MAX_IPS } from '@src/constants';
import {
  readEnvBoolean,
  readEnvInteger,
  readEnvNullableString,
  readEnvString,
} from '@src/config/environment';

// ── Allowed origins for localhost CSRF protection ──
const LOCALHOST_ORIGINS = new Set(['http://127.0.0.1', 'http://localhost', 'http://[::1]']);
const SAFE_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface HttpAuthRuntimeConfig {
  authToken?: string;
  host?: string;
  allowInsecure?: boolean;
}

export interface HttpRateLimitRuntimeConfig {
  enabled?: boolean;
  trustProxy?: boolean;
  windowMs?: number;
  maxRequests?: number;
}

/**
 * Reject cross-origin requests to localhost when no auth token is set.
 * Browsers always send Origin on POST/PUT/DELETE; its absence means
 * non-browser client (curl, SDK) which is fine.
 */
export function checkOrigin(
  req: IncomingMessage,
  res: ServerResponse,
  config?: Pick<HttpAuthRuntimeConfig, 'authToken' | 'host'>,
): boolean {
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

  const host = config?.host ?? readEnvString('MCP_HOST', '127.0.0.1', { trim: true });
  if (SAFE_LOCAL_HOSTS.has(host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden – cross-origin requests to a local MCP server are not allowed');
    return false;
  }

  const authToken = config?.authToken ?? readEnvNullableString('MCP_AUTH_TOKEN');
  if (authToken) return true;

  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('Forbidden – cross-origin requests require MCP_AUTH_TOKEN');
  return false;
}

// ── Auth middleware ──

/**
 * If `MCP_AUTH_TOKEN` is set, validates `Authorization: Bearer <token>`.
 * Returns `true` when the request is allowed to proceed.
 */
export function checkAuth(
  req: IncomingMessage,
  res: ServerResponse,
  config?: HttpAuthRuntimeConfig,
): boolean {
  const expected =
    config === undefined ? readEnvNullableString('MCP_AUTH_TOKEN') : (config.authToken ?? null);
  if (!expected) {
    // When binding to non-localhost without a token, reject unless explicitly allowed
    const host = config?.host ?? readEnvString('MCP_HOST', '127.0.0.1', { trim: true });
    // '0.0.0.0' and '::' bind to ALL interfaces (including external), so they
    // are NOT safe to treat as local — require auth or explicit insecure flag.
    const isLocal = SAFE_LOCAL_HOSTS.has(host);
    const allowInsecure = config?.allowInsecure ?? readEnvBoolean('MCP_ALLOW_INSECURE', false);
    if (!isLocal && !allowInsecure) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end(
        'Forbidden – MCP_AUTH_TOKEN is required when binding to non-localhost. Set MCP_ALLOW_INSECURE=1 to override.',
      );
      return false;
    }
    return true; // local access or explicitly insecure
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
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

// ── Body size limit middleware ──

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Reads the request body with a byte-size cap.
 * Resolves with the parsed JSON body, or rejects / sends 413 on overflow.
 */
export function readBodyWithLimit(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number = readEnvInteger('MCP_MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES, { min: 1 }),
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

// ── Sliding-window rate limiter per IP ──

const RATE_LIMIT_WINDOW_MS = readEnvInteger('MCP_RATE_LIMIT_WINDOW_MS', 60_000, { min: 1 });

const RATE_LIMIT_MAX_REQUESTS = readEnvInteger('MCP_RATE_LIMIT_MAX', 60, { min: 1 });

interface RateLimitEntry {
  /** Ring buffer of bucket slot ids (parallel to `counts`). Slot 0 = empty. */
  slots: number[];
  /** Ring buffer of per-slot request counts (parallel to `slots`). */
  counts: number[];
  /** Last activity timestamp, for idle-eviction during cleanup. */
  lastSeen: number;
}

/**
 * Number of fixed time buckets per IP. A bounded ring means the per-request
 * cost is O(1) regardless of how many requests one IP makes in a window —
 * the previous `timestamps` array grew linearly and each request re-filtered
 * it (a1-09).
 */
export const RATE_LIMIT_BUCKET_COUNT = 60;

const rateLimitStore = new Map<string, RateLimitEntry>();

function createRateLimitEntry(): RateLimitEntry {
  return {
    slots: Array.from<number>({ length: RATE_LIMIT_BUCKET_COUNT }).fill(0),
    counts: Array.from<number>({ length: RATE_LIMIT_BUCKET_COUNT }).fill(0),
    lastSeen: 0,
  };
}

/** Maximum number of tracked IPs to prevent unbounded memory growth under DDoS. */
const RATE_LIMIT_MAX_IPS = HTTP_RATE_LIMIT_MAX_IPS;

/** Periodic cleanup of stale entries. */
const CLEANUP_INTERVAL_MS = HTTP_CLEANUP_INTERVAL_MS;
let lastCleanup = Date.now();

function rateLimitCleanup(now: number, windowMs: number = RATE_LIMIT_WINDOW_MS): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [ip, entry] of rateLimitStore) {
    if (entry.lastSeen <= cutoff) {
      rateLimitStore.delete(ip);
    }
  }
}

/**
 * Test-only introspection: number of fixed time buckets tracked for an IP.
 * Always `RATE_LIMIT_BUCKET_COUNT`, proving per-IP storage cannot grow with
 * the request rate. Not part of the runtime API.
 */
export function rateLimitTrackedBuckets(ip: string): number {
  return rateLimitStore.get(ip)?.counts.length ?? 0;
}

/** Evict oldest entries when the map exceeds the IP cap. */
function rateLimitEvictIfNeeded(): void {
  if (rateLimitStore.size <= RATE_LIMIT_MAX_IPS) return;
  // Map iterates in insertion order — evict the oldest 10% of entries
  const evictCount = Math.ceil(RATE_LIMIT_MAX_IPS * 0.1);
  let removed = 0;
  for (const key of rateLimitStore.keys()) {
    if (removed >= evictCount) break;
    rateLimitStore.delete(key);
    removed++;
  }
}

function getClientIP(req: IncomingMessage, config?: HttpRateLimitRuntimeConfig): string {
  // Only trust X-Forwarded-For when explicitly opted in via MCP_TRUST_PROXY
  // Without this, an attacker can spoof XFF to bypass rate limiting.
  const trustProxy = config?.trustProxy ?? readEnvBoolean('MCP_TRUST_PROXY', false);

  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0]! : forwarded.split(',')[0]!;
      return first.trim();
    }
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
 *
 * @param authenticated - Pass `true` only AFTER the request has been verified
 *   by `checkAuth`. Do NOT infer from the presence of the Authorization header
 *   alone, as an attacker could spoof the header to obtain the higher limit.
 */
export function checkRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  authenticated = false,
  config?: HttpRateLimitRuntimeConfig,
): boolean {
  // Allow disabling rate limiting (e.g. behind an external rate limiter)
  if (!(config?.enabled ?? readEnvBoolean('MCP_RATE_LIMIT_ENABLED', true))) {
    return true;
  }

  // Only grant the higher limit when the caller has verified the token
  const configuredMaxRequests = config?.maxRequests ?? RATE_LIMIT_MAX_REQUESTS;
  const maxRequests = authenticated ? configuredMaxRequests * 3 : configuredMaxRequests;
  const windowMs = config?.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const bucketMs = Math.max(1, Math.ceil(windowMs / RATE_LIMIT_BUCKET_COUNT));

  const now = Date.now();
  rateLimitCleanup(now, windowMs);
  rateLimitEvictIfNeeded();

  const ip = getClientIP(req, config);
  let entry = rateLimitStore.get(ip);
  if (!entry) {
    entry = createRateLimitEntry();
    rateLimitStore.set(ip, entry);
  }
  entry.lastSeen = now;

  // Fixed-bucket ring: each request only touches its own slot and sums a
  // bounded number of buckets, so per-request work stays O(1) regardless of
  // how many requests a single IP has made within the window (a1-09).
  const currentSlot = Math.floor(now / bucketMs);
  const bucketIndex = currentSlot % RATE_LIMIT_BUCKET_COUNT;

  // The ring slot now belongs to a new bucket — reset the stale count it held.
  if (entry.slots[bucketIndex] !== currentSlot) {
    entry.slots[bucketIndex] = currentSlot;
    entry.counts[bucketIndex] = 0;
  }

  const oldestSlot = currentSlot - (RATE_LIMIT_BUCKET_COUNT - 1);
  let count = 0;
  for (let i = 0; i < RATE_LIMIT_BUCKET_COUNT; i++) {
    if (entry.slots[i]! >= oldestSlot) {
      count += entry.counts[i]!;
    }
  }

  if (count >= maxRequests) {
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.writeHead(429, {
      'Content-Type': 'text/plain',
      'Retry-After': String(retryAfterSec),
    });
    res.end(`Too Many Requests – limit is ${maxRequests} per ${retryAfterSec}s window`);
    return false;
  }

  entry.counts[bucketIndex] = (entry.counts[bucketIndex] ?? 0) + 1;
  return true;
}
