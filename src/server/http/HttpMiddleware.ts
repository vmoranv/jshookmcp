/**
 * HTTP middleware for MCP Streamable HTTP transport.
 *
 * - Bearer token authentication (opt-in via MCP_AUTH_TOKEN env)
 * - Request body size limiting (default 10 MB)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

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
  if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden – invalid token');
    return false;
  }

  return true;
}

/** Constant-time string comparison using XOR. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Body size limit middleware
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

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
