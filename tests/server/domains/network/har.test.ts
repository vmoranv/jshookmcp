import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { buildHar } from '@server/domains/network/har';
import type { BuildHarParams, Har, HarEntry } from '@server/domains/network/har';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawHarRequest = BuildHarParams['requests'][number];
type GetResponseFn = BuildHarParams['getResponse'];
type GetResponseBodyFn = BuildHarParams['getResponseBody'];
type RawHarResponse = Exclude<ReturnType<GetResponseFn>, undefined>;

function makeRequest(overrides: Partial<RawHarRequest> = {}): RawHarRequest {
  return {
    requestId: 'req-1',
    url: 'https://example.com/api/data',
    method: 'GET',
    headers: {},
    timestamp: 1700000000,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<RawHarResponse> = {}): RawHarResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    mimeType: 'application/json',
    timing: { receiveHeadersEnd: 120 },
    ...overrides,
  };
}

function getEntry(har: Har, index = 0): HarEntry {
  const entry = har.log.entries[index];
  expect(entry).toBeDefined();
  if (!entry) {
    throw new Error(`Expected HAR to contain an entry at index ${index}`);
  }
  return entry;
}

describe('buildHar', () => {
  let getResponseMock: Mock<GetResponseFn>;
  let getResponseBodyMock: Mock<GetResponseBodyFn>;

  beforeEach(() => {
    getResponseMock = vi.fn<GetResponseFn>();
    getResponseBodyMock = vi.fn<GetResponseBodyFn>();
  });

  // -----------------------------------------------------------------------
  // Basic structure
  // -----------------------------------------------------------------------
  it('returns a valid HAR 1.2 envelope with creator metadata', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
      creatorVersion: '1.2.3',
    });

    expect(har.log.version).toBe('1.2');
    expect(har.log.creator).toEqual({ name: 'jshookmcp', version: '1.2.3' });
    expect(har.log.entries).toHaveLength(1);
  });

  it('uses "unknown" as default creator version when not specified', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(har.log.creator.version).toBe('unknown');
  });

  // -----------------------------------------------------------------------
  // Empty inputs
  // -----------------------------------------------------------------------
  it('returns an empty entries array when no requests are provided', async () => {
    const har = await buildHar({
      requests: [],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(har.log.entries).toEqual([]);
    expect(getResponseMock).not.toHaveBeenCalled();
    expect(getResponseBodyMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Request mapping
  // -----------------------------------------------------------------------
  it('maps request method, URL, and httpVersion correctly', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ method: 'POST', url: 'https://api.test/v1/submit' })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const entry = getEntry(har);
    expect(entry.request.method).toBe('POST');
    expect(entry.request.url).toBe('https://api.test/v1/submit');
    expect(entry.request.httpVersion).toBe('HTTP/1.1');
  });

  it('converts headers from Record to name/value pairs', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ headers: { accept: 'text/html', 'x-custom': 'abc' } })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const headers = getEntry(har).request.headers;
    expect(headers).toContainEqual({ name: 'accept', value: 'text/html' });
    expect(headers).toContainEqual({ name: 'x-custom', value: 'abc' });
  });

  it('handles undefined request headers as empty array', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ headers: undefined })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).request.headers).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Query string extraction
  // -----------------------------------------------------------------------
  it('extracts query string parameters from the URL', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ url: 'https://example.com/api?foo=bar&baz=42' })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const qs = getEntry(har).request.queryString;
    expect(qs).toContainEqual({ name: 'foo', value: 'bar' });
    expect(qs).toContainEqual({ name: 'baz', value: '42' });
  });

  it('returns empty queryString for URLs without query parameters', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ url: 'https://example.com/plain' })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).request.queryString).toEqual([]);
  });

  it('returns empty queryString for malformed URLs', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ url: 'not-a-valid-url' })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).request.queryString).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Cookies
  // -----------------------------------------------------------------------
  it('parses request cookies from the Cookie header', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ headers: { cookie: 'session=abc123; lang=en' } })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const cookies = getEntry(har).request.cookies;
    expect(cookies).toContainEqual({ name: 'session', value: 'abc123' });
    expect(cookies).toContainEqual({ name: 'lang', value: 'en' });
  });

  it('handles cookie values containing equals signs', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ headers: { cookie: 'data=val=ue=test' } })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const cookies = getEntry(har).request.cookies;
    expect(cookies).toContainEqual({ name: 'data', value: 'val=ue=test' });
  });

  it('handles cookies without an equals sign', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ headers: { cookie: 'flag' } })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const cookies = getEntry(har).request.cookies;
    expect(cookies).toContainEqual({ name: 'flag', value: '' });
  });

  it('parses response cookies from Set-Cookie header', async () => {
    getResponseMock.mockReturnValue(
      makeResponse({ headers: { 'set-cookie': 'token=xyz789; sid=aaa' } })
    );
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const cookies = getEntry(har).response.cookies;
    expect(cookies).toContainEqual({ name: 'token', value: 'xyz789' });
  });

  it('returns empty cookies when no cookie header is present', async () => {
    getResponseMock.mockReturnValue(makeResponse({ headers: {} }));
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ headers: {} })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).request.cookies).toEqual([]);
    expect(getEntry(har).response.cookies).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Post data
  // -----------------------------------------------------------------------
  it('includes postData when the request has a body', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [
        makeRequest({
          method: 'POST',
          postData: '{"key":"value"}',
          headers: { 'content-type': 'application/json' },
        }),
      ],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const entry = getEntry(har);
    expect(entry.request.postData).toEqual({
      mimeType: 'application/json',
      text: '{"key":"value"}',
    });
    expect(entry.request.bodySize).toBe(15);
  });

  it('uses application/octet-stream when content-type header is missing for postData', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ method: 'POST', postData: 'rawbody', headers: {} })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).request.postData!.mimeType).toBe('application/octet-stream');
  });

  it('omits postData when request has no body', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ method: 'GET' })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).request.postData).toBeUndefined();
    expect(getEntry(har).request.bodySize).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Response mapping
  // -----------------------------------------------------------------------
  it('maps response status, statusText, and headers', async () => {
    getResponseMock.mockReturnValue(
      makeResponse({
        status: 404,
        statusText: 'Not Found',
        headers: { 'x-powered-by': 'test' },
      })
    );
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const resp = getEntry(har).response;
    expect(resp.status).toBe(404);
    expect(resp.statusText).toBe('Not Found');
    expect(resp.headers).toContainEqual({ name: 'x-powered-by', value: 'test' });
  });

  it('handles missing response gracefully (undefined)', async () => {
    getResponseMock.mockReturnValue(undefined);
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const resp = getEntry(har).response;
    expect(resp.status).toBe(0);
    expect(resp.statusText).toBe('');
    expect(resp.headers).toEqual([]);
    expect(resp.redirectURL).toBe('');
  });

  it('extracts redirect URL from location header', async () => {
    getResponseMock.mockReturnValue(
      makeResponse({
        status: 302,
        headers: { location: 'https://example.com/redirected' },
      })
    );
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).response.redirectURL).toBe('https://example.com/redirected');
  });

  // -----------------------------------------------------------------------
  // Timings
  // -----------------------------------------------------------------------
  it('populates timings from response timing data', async () => {
    getResponseMock.mockReturnValue(makeResponse({ timing: { receiveHeadersEnd: 250 } }));
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const entry = getEntry(har);
    expect(entry.time).toBe(250);
    expect(entry.timings.wait).toBe(250);
    expect(entry.timings.send).toBe(0);
    expect(entry.timings.receive).toBe(0);
  });

  it('defaults timings to 0 when response has no timing data', async () => {
    getResponseMock.mockReturnValue(makeResponse({ timing: undefined }));
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).time).toBe(0);
    expect(getEntry(har).timings.wait).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Date / timestamp
  // -----------------------------------------------------------------------
  it('converts request timestamp to ISO 8601 startedDateTime', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ timestamp: 1700000000 })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const expected = new Date(1700000000 * 1000).toISOString();
    expect(getEntry(har).startedDateTime).toBe(expected);
  });

  it('uses current time when request has no timestamp', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const before = new Date().toISOString();

    const har = await buildHar({
      requests: [makeRequest({ timestamp: undefined })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    const after = new Date().toISOString();
    const started = getEntry(har).startedDateTime;
    expect(started >= before).toBe(true);
    expect(started <= after).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Response bodies (includeBodies)
  // -----------------------------------------------------------------------
  it('fetches and includes response bodies when includeBodies is true', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue({ body: '{"result":42}', base64Encoded: false });

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: true,
    });

    const content = getEntry(har).response.content;
    expect(content.text).toBe('{"result":42}');
    expect(content.size).toBe(13);
    expect(content._bodyUnavailable).toBeUndefined();
  });

  it('does not fetch bodies when includeBodies is false', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getResponseBodyMock).not.toHaveBeenCalled();
    expect(getEntry(har).response.content.text).toBeUndefined();
  });

  it('marks body as unavailable when getResponseBody returns null', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: true,
    });

    expect(getEntry(har).response.content._bodyUnavailable).toBe(true);
  });

  it('marks body as unavailable when getResponseBody throws', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockRejectedValue(new Error('CDP error'));

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: true,
    });

    expect(getEntry(har).response.content._bodyUnavailable).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Multiple requests
  // -----------------------------------------------------------------------
  it('processes multiple requests and preserves order', async () => {
    const requests = [
      makeRequest({ requestId: 'r1', url: 'https://a.com/1', method: 'GET' }),
      makeRequest({ requestId: 'r2', url: 'https://b.com/2', method: 'POST', postData: 'x' }),
      makeRequest({ requestId: 'r3', url: 'https://c.com/3', method: 'PUT' }),
    ];

    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests,
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(har.log.entries).toHaveLength(3);
    expect(getEntry(har)._requestId).toBe('r1');
    expect(getEntry(har, 1)._requestId).toBe('r2');
    expect(getEntry(har, 2)._requestId).toBe('r3');
  });

  // -----------------------------------------------------------------------
  // Body fetching concurrency
  // -----------------------------------------------------------------------
  it('fetches bodies in batches of 8 to limit concurrency', async () => {
    const requests = Array.from({ length: 20 }, (_, i) =>
      makeRequest({ requestId: `r-${i}`, url: `https://example.com/${i}` })
    );

    getResponseMock.mockReturnValue(makeResponse());

    let concurrentCalls = 0;
    let maxConcurrent = 0;
    getResponseBodyMock.mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCalls--;
      return { body: 'data', base64Encoded: false };
    });

    await buildHar({
      requests,
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: true,
    });

    expect(getResponseBodyMock).toHaveBeenCalledTimes(20);
    expect(maxConcurrent).toBeLessThanOrEqual(8);
  });

  // -----------------------------------------------------------------------
  // _requestId field
  // -----------------------------------------------------------------------
  it('includes _requestId in each entry for correlation', async () => {
    getResponseMock.mockReturnValue(makeResponse());
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest({ requestId: 'my-special-id' })],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har)._requestId).toBe('my-special-id');
  });

  // -----------------------------------------------------------------------
  // Mime type fallback
  // -----------------------------------------------------------------------
  it('defaults content mimeType to application/octet-stream when response has no mimeType', async () => {
    getResponseMock.mockReturnValue(makeResponse({ mimeType: undefined }));
    getResponseBodyMock.mockResolvedValue(null);

    const har = await buildHar({
      requests: [makeRequest()],
      getResponse: getResponseMock,
      getResponseBody: getResponseBodyMock,
      includeBodies: false,
    });

    expect(getEntry(har).response.content.mimeType).toBe('application/octet-stream');
  });
});
