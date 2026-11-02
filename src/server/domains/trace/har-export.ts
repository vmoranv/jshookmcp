/**
 * HAR (HTTP Archive) 1.4 export for trace databases.
 *
 * Joins the `network_resources` table into the HAR interchange format so traces
 * interop with browser-RE tooling (Burp/ZAP/Postman/charles). Pure data
 * projection — no heuristic library, no body decoding beyond what the schema
 * already captured inline.
 *
 * Reference: http://www.softwareishard.com/blog/har-12-spec/
 */

import type { TraceDB } from '@modules/trace/TraceDB';
import { mapNetworkResourceRow } from '@modules/trace/TraceDB.internal';

export interface HarExportOptions {
  /** Creator block (defaults to a jshookmcp-identifying record). */
  creator?: { name: string; version: string };
  /** Optional page title for the single-page HAR log. */
  pageTitle?: string;
}

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    cookies: unknown[];
    headers: HarHeader[];
    queryString: unknown[];
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: unknown[];
    headers: HarHeader[];
    redirectURL: string;
    headersSize: number;
    bodySize: number;
    content: {
      size: number;
      mimeType: string;
      text?: string;
      encoding?: string;
    };
  };
  cache: Record<string, unknown>;
  timings: { send: number; wait: number; receive: number };
  _jshookmcp?: Record<string, unknown>;
}

export interface HarLog {
  log: {
    version: '1.4';
    creator: { name: string; version: string };
    pages: Array<{
      id: string;
      startedDateTime: string;
      title: string;
      pageTimings: { onContentLoad: number; onLoad: number };
    }>;
    entries: HarEntry[];
  };
}

const DEFAULT_CREATOR = { name: 'jshookmcp trace export', version: '1.0' };
const EPOCH_MS_FLOOR = 1e12;

const fromSqliteBoolean = (value: unknown): boolean => value === 1 || value === true;

/**
 * Convert a CDP-style wall timestamp to an ISO 8601 string. CDP emits fractional
 * epoch seconds (e.g. 1700000000.123); epoch milliseconds are > 1e12. Detect the
 * unit so both storage conventions serialize correctly. Returns null when the
 * value is missing or unparseable — HAR callers substitute the epoch sentinel.
 */
function wallTimeToIso(t: number | null | undefined): string | null {
  if (t === null || t === undefined || !Number.isFinite(t)) return null;
  const ms = t > EPOCH_MS_FLOOR ? t : t * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseHeaderPairs(json: string | null | undefined): HarHeader[] {
  if (!json) return [];
  try {
    const obj = JSON.parse(json) as unknown;
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];
    const entries = Object.entries(obj as Record<string, unknown>);
    return entries.map(([name, value]) => ({
      name,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
  } catch {
    return [];
  }
}

/**
 * Build a HAR 1.4 log from a trace database. Reads `network_resources` in
 * started-time order. Response bodies are included only when captured inline
 * (`body_inline`, ≤ networkInlineBodyBytes); artifact-backed large bodies are
 * referenced as `_jshookmcp.bodyArtifactPath` rather than loaded — HAR consumers
 * that need the full body can re-read the artifact. Failed requests are tagged
 * via `_jshookmcp.failed`.
 */
export function buildHarLog(db: TraceDB, options: HarExportOptions = {}): HarLog {
  const creator = options.creator ?? DEFAULT_CREATOR;

  const result = db.queryWithParams(
    `SELECT * FROM network_resources
     ORDER BY COALESCE(started_wall_time, started_monotonic_time, response_wall_time, 0) ASC`,
    [],
  );

  const entries: HarEntry[] = result.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < result.columns.length; i++) {
      record[result.columns[i]!] = row[i];
    }
    const r = mapNetworkResourceRow(record, fromSqliteBoolean);

    const startedMs = r.startedWallTime ?? null;
    const finishedMs = r.finishedWallTime ?? r.responseWallTime ?? startedMs;
    const isEpochSeconds = startedMs !== null && startedMs <= EPOCH_MS_FLOOR;
    const elapsedMs =
      startedMs !== null && finishedMs !== null && finishedMs >= startedMs
        ? (finishedMs - startedMs) * (isEpochSeconds ? 1000 : 1)
        : 0;

    const startedIso =
      wallTimeToIso(startedMs) ?? wallTimeToIso(r.responseWallTime) ?? '1970-01-01T00:00:00.000Z';

    const requestHeaders = parseHeaderPairs(r.requestHeaders);
    const responseHeaders = parseHeaderPairs(r.responseHeaders);
    const hasInlineBody = typeof r.bodyInline === 'string' && r.bodyInline.length > 0;
    const contentSize = r.bodySize ?? (hasInlineBody ? r.bodyInline!.length : 0);

    const entry: HarEntry = {
      startedDateTime: startedIso,
      time: elapsedMs,
      request: {
        method: r.method ?? 'GET',
        url: r.url ?? '',
        httpVersion: r.protocol ?? 'http/1.1',
        cookies: [],
        headers: requestHeaders,
        queryString: [],
        headersSize: -1,
        bodySize: r.requestPostData !== null ? r.requestPostData.length : 0,
        ...(r.requestPostData !== null
          ? {
              postData: {
                // HAR 1.4: postData.mimeType is the *request* content type —
                // r.mimeType is the response's, which differs for e.g.
                // form-encoded requests returning JSON.
                mimeType:
                  requestHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value ??
                  r.mimeType ??
                  'application/octet-stream',
                text: r.requestPostData,
              },
            }
          : {}),
      },
      response: {
        status: r.status ?? 0,
        statusText: r.statusText ?? '',
        httpVersion: r.protocol ?? 'http/1.1',
        cookies: [],
        headers: responseHeaders,
        redirectURL: '',
        headersSize: -1,
        bodySize: r.bodySize ?? 0,
        content: {
          size: contentSize,
          mimeType: r.mimeType ?? 'application/octet-stream',
          ...(r.bodyBase64Encoded ? { encoding: 'base64' } : {}),
          ...(hasInlineBody ? { text: r.bodyInline ?? undefined } : {}),
        },
      },
      cache: {},
      // We only know start→finish; split it all into "wait". send/receive stay 0
      // (no per-phase timing captured) — honest degradation, not fabrication.
      timings: { send: 0, wait: elapsedMs, receive: 0 },
    };

    const extras: Record<string, unknown> = {};
    if (r.failed) {
      extras['failed'] = true;
      if (r.errorText) extras['errorText'] = r.errorText;
    }
    if (r.bodyArtifactPath) {
      extras['bodyArtifactPath'] = r.bodyArtifactPath;
    }
    if (r.fromDiskCache) extras['fromDiskCache'] = true;
    if (r.fromServiceWorker) extras['fromServiceWorker'] = true;
    if (Object.keys(extras).length > 0) {
      entry['_jshookmcp'] = extras;
    }
    return entry;
  });

  return {
    log: {
      version: '1.4',
      creator,
      pages: [
        {
          id: 'page_1',
          startedDateTime: entries[0]?.startedDateTime ?? '1970-01-01T00:00:00.000Z',
          title: options.pageTitle ?? 'jshookmcp trace export',
          pageTimings: { onContentLoad: -1, onLoad: -1 },
        },
      ],
      entries,
    },
  };
}
