/**
 * Auth Extractor — scans captured network requests for authentication credentials.
 * Masks sensitive values before returning (first 6 + last 4 chars).
 */

export interface AuthFinding {
  header: string;
  value_masked: string;
  request_url: string;
  confidence: number;
  source: 'header' | 'cookie' | 'query' | 'body';
}

const AUTH_HEADER_KEYS = [
  'authorization',
  'cookie',
  'x-token',
  'x-auth-token',
  'x-access-token',
  'x-api-key',
  'x-signature',
  'x-sign',
  'x-csrf-token',
];

const TOKEN_BODY_KEYS = /^(token|access_token|refresh_token|sign|signature|auth|jwt|api_key|apikey|key|secret)$/i;

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BEARER_RE = /^Bearer\s+\S+/i;

function maskSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 12) return '***';
  return `${trimmed.slice(0, 6)}***${trimmed.slice(-4)}`;
}

function scoreValue(value: string): number {
  const v = value.trim();
  if (BEARER_RE.test(v)) return 0.95;
  if (JWT_RE.test(v)) return 0.9;
  if (v.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(v)) return 0.7;
  if (v.length > 10) return 0.5;
  return 0.3;
}

interface CapturedRequest {
  url: string;
  headers?: Record<string, string>;
  postData?: string;
}

export function extractAuthFromRequests(requests: CapturedRequest[]): AuthFinding[] {
  const findings: AuthFinding[] = [];
  const seen = new Set<string>();

  for (const req of requests) {
    const headers = req.headers ?? {};

    // Scan headers
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (!AUTH_HEADER_KEYS.includes(lk)) continue;
      if (!v || v.length < 4) continue;

      // For Cookie header, extract individual cookies
      if (lk === 'cookie') {
        for (const part of v.split(';')) {
          const eqIdx = part.indexOf('=');
          if (eqIdx === -1) continue;
          const name = part.slice(0, eqIdx).trim();
          const val = part.slice(eqIdx + 1).trim();
          if (!val || val.length < 8) continue;
          const dedupeKey = `cookie:${name}:${val.slice(0, 8)}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          findings.push({
            header: `cookie[${name}]`,
            value_masked: maskSecret(val),
            request_url: req.url,
            confidence: scoreValue(val),
            source: 'cookie',
          });
        }
        continue;
      }

      const dedupeKey = `header:${lk}:${v.slice(0, 8)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      findings.push({
        header: k,
        value_masked: maskSecret(v),
        request_url: req.url,
        confidence: scoreValue(v),
        source: 'header',
      });
    }

    // Scan URL query params
    try {
      const u = new URL(req.url);
      for (const [k, v] of u.searchParams.entries()) {
        if (!TOKEN_BODY_KEYS.test(k)) continue;
        if (!v || v.length < 8) continue;
        const dedupeKey = `query:${k}:${v.slice(0, 8)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        findings.push({
          header: k,
          value_masked: maskSecret(v),
          request_url: req.url,
          confidence: scoreValue(v) * 0.9,
          source: 'query',
        });
      }
    } catch {
      // invalid URL, skip
    }

    // Scan request body (JSON)
    if (req.postData) {
      try {
        const body = JSON.parse(req.postData);
        if (body && typeof body === 'object') {
          for (const [k, v] of Object.entries(body)) {
            if (!TOKEN_BODY_KEYS.test(k)) continue;
            if (typeof v !== 'string' || v.length < 8) continue;
            const dedupeKey = `body:${k}:${v.slice(0, 8)}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            findings.push({
              header: k,
              value_masked: maskSecret(v),
              request_url: req.url,
              confidence: scoreValue(v) * 0.85,
              source: 'body',
            });
          }
        }
      } catch {
        // not JSON, skip
      }
    }
  }

  // Sort by confidence desc
  return findings.sort((a, b) => b.confidence - a.confidence);
}
