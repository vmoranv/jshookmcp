/**
 * HAR 1.2 builder — converts NetworkMonitor captured data to standard HAR format.
 * Ref: http://www.softwareishard.com/blog/har-12-spec/
 */

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    content: {
      size: number;
      mimeType: string;
      text?: string;
      _bodyUnavailable?: boolean;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, unknown>;
  timings: { send: number; wait: number; receive: number };
  _requestId?: string;
}

export interface Har {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

function headersToHar(headers: Record<string, string> = {}): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function parseCookies(cookieHeader: string): Array<{ name: string; value: string }> {
  return cookieHeader.split(';').map((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return { name: part.trim(), value: '' };
    return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
  });
}

function queryStringFromUrl(url: string): Array<{ name: string; value: string }> {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

interface RawRequest {
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  postData?: string;
  timestamp?: number;
  resourceType?: string;
}

interface RawResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  mimeType?: string;
  timing?: { receiveHeadersEnd?: number };
}

export interface BuildHarParams {
  requests: RawRequest[];
  getResponse: (requestId: string) => RawResponse | undefined;
  getResponseBody: (requestId: string) => Promise<{ body: string; base64Encoded: boolean } | null>;
  includeBodies: boolean;
  creatorVersion?: string;
}

export async function buildHar(params: BuildHarParams): Promise<Har> {
  const { requests, getResponse, getResponseBody, includeBodies, creatorVersion = 'unknown' } = params;
  const entries: HarEntry[] = [];

  // Parallel body fetching with concurrency limit to avoid overwhelming CDP
  const bodyResults = new Map<string, { text?: string; _bodyUnavailable?: boolean }>();
  if (includeBodies) {
    const BODY_CONCURRENCY = 8;
    for (let i = 0; i < requests.length; i += BODY_CONCURRENCY) {
      const batch = requests.slice(i, i + BODY_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (req) => {
          try {
            const bodyResult = await getResponseBody(req.requestId);
            if (bodyResult) {
              return { requestId: req.requestId, text: bodyResult.body };
            }
            return { requestId: req.requestId, _bodyUnavailable: true as const };
          } catch {
            return { requestId: req.requestId, _bodyUnavailable: true as const };
          }
        })
      );
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          const val = result.value;
          bodyResults.set(val.requestId, '_bodyUnavailable' in val ? { _bodyUnavailable: true } : { text: val.text });
        }
      }
    }
  }

  for (const req of requests) {
    const res = getResponse(req.requestId);
    const startedDateTime = req.timestamp ? new Date(req.timestamp * 1000).toISOString() : new Date().toISOString();
    const bodyContent = includeBodies
      ? (bodyResults.get(req.requestId) ?? { _bodyUnavailable: true })
      : {};

    const postData = req.postData
      ? {
          mimeType: req.headers?.['content-type'] ?? 'application/octet-stream',
          text: req.postData,
        }
      : undefined;

    const reqCookieHeader = req.headers?.['cookie'] ?? '';
    const resCookieHeader = res?.headers?.['set-cookie'] ?? '';

    const entry: HarEntry = {
      startedDateTime,
      time: res?.timing?.receiveHeadersEnd ?? 0,
      request: {
        method: req.method,
        url: req.url,
        httpVersion: 'HTTP/1.1',
        headers: headersToHar(req.headers),
        queryString: queryStringFromUrl(req.url),
        cookies: reqCookieHeader ? parseCookies(reqCookieHeader) : [],
        headersSize: -1,
        bodySize: req.postData ? req.postData.length : 0,
        ...(postData ? { postData } : {}),
      },
      response: {
        status: res?.status ?? 0,
        statusText: res?.statusText ?? '',
        httpVersion: 'HTTP/1.1',
        headers: headersToHar(res?.headers),
        cookies: resCookieHeader ? parseCookies(resCookieHeader) : [],
        content: {
          size: bodyContent.text ? bodyContent.text.length : -1,
          mimeType: res?.mimeType ?? 'application/octet-stream',
          ...bodyContent,
        },
        redirectURL: res?.headers?.['location'] ?? '',
        headersSize: -1,
        bodySize: bodyContent.text ? bodyContent.text.length : -1,
      },
      cache: {},
      timings: { send: 0, wait: res?.timing?.receiveHeadersEnd ?? 0, receive: 0 },
      _requestId: req.requestId,
    };

    entries.push(entry);
  }

  return {
    log: {
      version: '1.2',
      creator: { name: 'jshhookmcp', version: creatorVersion },
      entries,
    },
  };
}
