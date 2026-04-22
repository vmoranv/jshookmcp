import { describe, expect, it } from 'vitest';

import {
  analyzeHttpResponse,
  buildHttpRequest,
  isLikelyTextHttpBody,
} from '@server/domains/network/http-raw';

describe('network http-raw buildHttpRequest', () => {
  it('builds minimal GET with auto headers', async () => {
    const built = buildHttpRequest({
      method: 'post',
      target: '/submit',
      host: 'lab.example.com',
      body: '{"ok":true}',
    });
    expect(built.startLine).toBe('POST /submit HTTP/1.1');
    expect(built.headers.Host).toBe('lab.example.com');
    expect(built.headers['Content-Length']).toBe(String(Buffer.byteLength('{"ok":true}', 'utf8')));
    expect(built.headers.Connection).toBe('close');
    expect(built.requestText).toContain('\r\n\r\n{"ok":true}');
  });

  it('builds clean request with no auto headers', async () => {
    const built = buildHttpRequest({
      method: 'GET',
      target: '/',
      addHostHeader: false,
      addConnectionClose: false,
    });
    expect(built.requestText).toBe('GET / HTTP/1.1\r\n\r\n');
  });

  it('uses HTTP/1.0 when specified', async () => {
    const built = buildHttpRequest({
      method: 'GET',
      target: '/api',
      httpVersion: '1.0',
      addHostHeader: false,
      addConnectionClose: false,
    });
    expect(built.startLine).toBe('GET /api HTTP/1.0');
    expect(built.httpVersion).toBe('1.0');
  });

  it('throws on invalid method token', async () => {
    expect(() => buildHttpRequest({ method: 'GET POST', target: '/' })).toThrow(
      'method must be a valid HTTP token',
    );
  });

  it('throws on empty target', async () => {
    expect(() => buildHttpRequest({ method: 'GET', target: '  ' })).toThrow('target is required');
  });

  it('throws on target with line break', async () => {
    expect(() => buildHttpRequest({ method: 'GET', target: '/path\r\nX-Extra: evil' })).toThrow(
      'must not contain CR or LF',
    );
  });

  it('throws on invalid httpVersion', async () => {
    expect(() =>
      buildHttpRequest({ method: 'GET', target: '/', httpVersion: '2.0' as '1.0' }),
    ).toThrow('httpVersion must be either "1.0" or "1.1"');
  });

  it('throws on invalid header name', async () => {
    expect(() =>
      buildHttpRequest({
        method: 'GET',
        target: '/',
        headers: { 'Bad Name': 'value' },
      }),
    ).toThrow('Invalid HTTP header name');
  });

  it('throws on header value with line break', async () => {
    expect(() =>
      buildHttpRequest({
        method: 'GET',
        target: '/',
        headers: { 'X-Test': 'val\r\nue' },
      }),
    ).toThrow('must not contain CR or LF');
  });

  it('skips Content-Length when Transfer-Encoding is set', async () => {
    const built = buildHttpRequest({
      method: 'POST',
      target: '/',
      body: 'chunked-data',
      headers: { 'Transfer-Encoding': 'chunked' },
      addHostHeader: false,
    });
    expect(built.headers['Content-Length']).toBeUndefined();
    expect(built.headers['Transfer-Encoding']).toBe('chunked');
  });

  it('skips Content-Length when no body is provided', async () => {
    const built = buildHttpRequest({
      method: 'GET',
      target: '/',
      addHostHeader: false,
      addConnectionClose: false,
    });
    expect(built.headers['Content-Length']).toBeUndefined();
  });

  it('skips Host header when addHostHeader is false', async () => {
    const built = buildHttpRequest({
      method: 'GET',
      target: '/',
      host: 'example.com',
      addHostHeader: false,
      addConnectionClose: false,
    });
    expect(built.headers.Host).toBeUndefined();
  });

  it('skips Host header when already present in headers', async () => {
    const built = buildHttpRequest({
      method: 'GET',
      target: '/',
      host: 'other.com',
      headers: { Host: 'custom.com' },
      addConnectionClose: false,
    });
    expect(built.headers.Host).toBe('custom.com');
  });

  it('throws on host with line break', async () => {
    expect(() => buildHttpRequest({ method: 'GET', target: '/', host: 'evil\r\n.com' })).toThrow(
      'must not contain CR or LF',
    );
  });

  it('includes custom headers in output', async () => {
    const built = buildHttpRequest({
      method: 'GET',
      target: '/',
      headers: { Accept: 'text/html', 'X-Custom': '123' },
      addHostHeader: false,
      addConnectionClose: false,
    });
    expect(built.headers.Accept).toBe('text/html');
    expect(built.headers['X-Custom']).toBe('123');
    expect(built.requestHex.length).toBeGreaterThan(0);
  });

  it('reports correct byte counts', async () => {
    const body = 'hello world';
    const built = buildHttpRequest({
      method: 'POST',
      target: '/',
      body,
      addHostHeader: false,
    });
    expect(built.bodyBytes).toBe(Buffer.byteLength(body, 'utf8'));
    expect(built.requestBytes).toBe(Buffer.byteLength(built.requestText, 'utf8'));
  });

  it('skips Content-Length when addContentLength is false', async () => {
    const built = buildHttpRequest({
      method: 'POST',
      target: '/',
      body: 'data',
      addContentLength: false,
      addHostHeader: false,
    });
    expect(built.headers['Content-Length']).toBeUndefined();
  });

  it('skips Connection when already present in headers', async () => {
    const built = buildHttpRequest({
      method: 'GET',
      target: '/',
      headers: { Connection: 'keep-alive' },
      addHostHeader: false,
    });
    expect(built.headers.Connection).toBe('keep-alive');
  });

  it('skips Content-Length for non-string header value', async () => {
    expect(() =>
      buildHttpRequest({
        method: 'GET',
        target: '/',
        headers: { 'X-Num': 42 as unknown as string },
        addHostHeader: false,
        addConnectionClose: false,
      }),
    ).toThrow('must be a string');
  });
});

describe('network http-raw analyzeHttpResponse', () => {
  it('returns null when header terminator is missing', async () => {
    expect(analyzeHttpResponse(Buffer.from('HTTP/1.1 200 OK'))).toBeNull();
  });

  it('throws on empty header block', async () => {
    expect(() => analyzeHttpResponse(Buffer.from('\r\n\r\n'))).toThrow(
      'HTTP response did not contain a status line',
    );
  });

  it('throws on invalid status line', async () => {
    expect(() => analyzeHttpResponse(Buffer.from('NOTHTTP something\r\n\r\n'))).toThrow(
      'Invalid HTTP status line',
    );
  });

  it('parses status line without status text', async () => {
    const raw = Buffer.from('HTTP/1.1 204\r\n\r\n');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.statusCode).toBe(204);
    expect(parsed!.statusText).toBe('');
    expect(parsed!.bodyMode).toBe('none');
    expect(parsed!.complete).toBe(true);
  });

  it('handles bodyless HEAD response', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n');
    const parsed = analyzeHttpResponse(raw, 'HEAD');
    expect(parsed!.bodyMode).toBe('none');
    expect(parsed!.bodyBytes).toBe(0);
    expect(parsed!.complete).toBe(true);
  });

  it('handles 1xx informational response', async () => {
    const raw = Buffer.from('HTTP/1.1 100 Continue\r\n\r\n');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyMode).toBe('none');
    expect(parsed!.complete).toBe(true);
  });

  it('handles 304 Not Modified', async () => {
    const raw = Buffer.from('HTTP/1.1 304 Not Modified\r\nETag: abc\r\n\r\n');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyMode).toBe('none');
    expect(parsed!.complete).toBe(true);
  });

  it('decodes chunked payloads', async () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n5\r\nhello\r\n0\r\n\r\n',
      'utf8',
    );
    const parsed = analyzeHttpResponse(raw, 'GET');
    expect(parsed).not.toBeNull();
    expect(parsed!.statusCode).toBe(200);
    expect(parsed!.chunkedDecoded).toBe(true);
    expect(parsed!.complete).toBe(true);
    expect(parsed!.bodyMode).toBe('chunked');
    expect(parsed!.bodyBuffer.toString('utf8')).toBe('hello');
  });

  it('handles chunked body with LF-only line endings', async () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\nTransfer-Encoding: chunked\n\n5\nhello\n0\n\n',
      'utf8',
    );
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyMode).toBe('chunked');
    expect(parsed!.bodyBuffer.toString('utf8')).toBe('hello');
  });

  it('handles incomplete chunked body', async () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhel',
      'utf8',
    );
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyMode).toBe('chunked');
    expect(parsed!.complete).toBe(false);
  });

  it('handles chunked body with invalid chunk size', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nZZ\r\n', 'utf8');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyMode).toBe('chunked');
    expect(parsed!.complete).toBe(false);
  });

  it('handles chunked body with trailers', async () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nX-Trailer: yes\r\n\r\n',
      'utf8',
    );
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.chunkedDecoded).toBe(true);
    expect(parsed!.complete).toBe(true);
  });

  it('handles chunked body with CRLF trailer terminator', async () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n',
      'utf8',
    );
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.complete).toBe(true);
  });

  it('handles chunked body with LF-only trailer terminator', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\n\n', 'utf8');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.complete).toBe(true);
  });

  it('handles multi-chunk payload', async () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nhel\r\n2\r\nlo\r\n0\r\n\r\n',
      'utf8',
    );
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyBuffer.toString('utf8')).toBe('hello');
    expect(parsed!.complete).toBe(true);
  });

  it('handles content-length response', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello', 'utf8');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyMode).toBe('content-length');
    expect(parsed!.complete).toBe(true);
    expect(parsed!.bodyBuffer.toString('utf8')).toBe('hello');
    expect(parsed!.expectedRawBytes).toBe(raw.indexOf('\r\n\r\n') + 4 + 5);
  });

  it('marks content-length response incomplete when truncated', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhel', 'utf8');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.complete).toBe(false);
    expect(parsed!.bodyBuffer.toString('utf8')).toBe('hel');
  });

  it('handles invalid content-length gracefully', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: NaN\r\n\r\ndata', 'utf8');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyMode).toBe('until-close');
    expect(parsed!.complete).toBe(false);
  });

  it('falls through to until-close mode', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\n\r\nsome body', 'utf8');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.bodyMode).toBe('until-close');
    expect(parsed!.complete).toBe(false);
    expect(parsed!.bodyBuffer.toString('utf8')).toBe('some body');
  });

  it('coalesces duplicate headers', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nX-Foo: a\r\nX-Foo: b\r\n\r\n', 'utf8');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.headers['X-Foo']).toBe('a, b');
  });

  it('coalesces set-cookie headers', async () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\n\r\n',
      'utf8',
    );
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.headers['Set-Cookie']).toBe('a=1, b=2');
  });

  it('skips header lines with no colon separator', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nbadheader\r\nX-Valid: yes\r\n\r\n');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed!.headers['X-Valid']).toBe('yes');
  });

  it('handles LF-only header terminator', async () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\nContent-Length: 0\n\n', 'utf8');
    const parsed = analyzeHttpResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.statusCode).toBe(200);
  });
});

describe('network http-raw isLikelyTextHttpBody', () => {
  it('returns true for empty body', async () => {
    expect(isLikelyTextHttpBody(null, Buffer.alloc(0))).toBe(true);
  });

  it('returns true for text/* content type', async () => {
    expect(isLikelyTextHttpBody('text/html', Buffer.from('<b>bold</b>'))).toBe(true);
  });

  it('returns true for application/json content type', async () => {
    expect(isLikelyTextHttpBody('application/json', Buffer.from('{}'))).toBe(true);
  });

  it('returns true for application/xml', async () => {
    expect(isLikelyTextHttpBody('application/xml', Buffer.from('<r/>'))).toBe(true);
  });

  it('returns true for application/javascript', async () => {
    expect(isLikelyTextHttpBody('application/javascript', Buffer.from('var x=1'))).toBe(true);
  });

  it('returns true for image/svg+xml', async () => {
    expect(isLikelyTextHttpBody('image/svg+xml', Buffer.from('<svg/>'))).toBe(true);
  });

  it('returns false for binary body with null byte', async () => {
    expect(isLikelyTextHttpBody(null, Buffer.from([0x00, 0xff, 0x10, 0x42]))).toBe(false);
  });

  it('returns true for text-like body without content type', async () => {
    expect(isLikelyTextHttpBody(undefined, Buffer.from('plain text'))).toBe(true);
  });

  it('returns true for application/x-www-form-urlencoded', async () => {
    expect(isLikelyTextHttpBody('application/x-www-form-urlencoded', Buffer.from('a=b'))).toBe(
      true,
    );
  });

  it('returns true for application/problem+json', async () => {
    expect(isLikelyTextHttpBody('application/problem+json', Buffer.from('{}'))).toBe(true);
  });
});
