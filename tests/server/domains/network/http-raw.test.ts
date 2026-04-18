import { describe, expect, it } from 'vitest';

import {
  analyzeHttpResponse,
  buildHttpRequest,
  isLikelyTextHttpBody,
} from '@server/domains/network/http-raw';

describe('network http raw helpers', () => {
  it('buildHttpRequest injects Host, Content-Length, and Connection headers', () => {
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

  it('buildHttpRequest avoids malformed extra CRLF when no headers are present', () => {
    const built = buildHttpRequest({
      method: 'GET',
      target: '/',
      addHostHeader: false,
      addConnectionClose: false,
    });

    expect(built.requestText).toBe('GET / HTTP/1.1\r\n\r\n');
  });

  it('analyzeHttpResponse decodes chunked payloads', () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n5\r\nhello\r\n0\r\n\r\n',
      'utf8',
    );

    const parsed = analyzeHttpResponse(raw, 'GET');
    expect(parsed).not.toBeNull();
    expect(parsed?.statusCode).toBe(200);
    expect(parsed?.chunkedDecoded).toBe(true);
    expect(parsed?.complete).toBe(true);
    expect(parsed?.bodyMode).toBe('chunked');
    expect(parsed?.bodyBuffer.toString('utf8')).toBe('hello');
  });

  it('marks content-length responses incomplete when the body is truncated', () => {
    const raw = Buffer.from(
      'HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: text/plain\r\n\r\nhel',
      'utf8',
    );

    const parsed = analyzeHttpResponse(raw, 'GET');
    expect(parsed).not.toBeNull();
    expect(parsed?.complete).toBe(false);
    expect(parsed?.bodyMode).toBe('content-length');
    expect(parsed?.bodyBuffer.toString('utf8')).toBe('hel');
  });

  it('isLikelyTextHttpBody uses content type and byte heuristics', () => {
    expect(isLikelyTextHttpBody('application/json', Buffer.from('{"ok":true}', 'utf8'))).toBe(true);
    expect(isLikelyTextHttpBody(null, Buffer.from([0x00, 0xff, 0x10, 0x42]))).toBe(false);
  });
});
