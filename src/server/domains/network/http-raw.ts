const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const TEXTUAL_CONTENT_TYPE_RE =
  /^(?:text\/|application\/(?:json|ld\+json|xml|xhtml\+xml|javascript|x-javascript|problem\+json|problem\+xml|graphql-response\+json|x-www-form-urlencoded)|image\/svg\+xml)/i;

export interface HttpRequestBuildInput {
  method: string;
  target: string;
  headers?: Record<string, string>;
  body?: string;
  host?: string;
  httpVersion?: '1.0' | '1.1';
  addHostHeader?: boolean;
  addContentLength?: boolean;
  addConnectionClose?: boolean;
}

export interface BuiltHttpRequest {
  requestText: string;
  requestHex: string;
  requestBytes: number;
  startLine: string;
  headers: Record<string, string>;
  bodyBytes: number;
  httpVersion: '1.0' | '1.1';
}

export interface ParsedHttpHeader {
  name: string;
  value: string;
}

export interface ParsedHttpResponse {
  statusLine: string;
  httpVersion: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  rawHeaders: ParsedHttpHeader[];
  headerBytes: number;
  bodyBytes: number;
  bodyBuffer: Buffer;
  bodyMode: 'none' | 'content-length' | 'chunked' | 'until-close';
  complete: boolean;
  expectedRawBytes: number | null;
  chunkedDecoded: boolean;
}

function assertNoLineBreak(value: string, field: string): void {
  if (value.includes('\r') || value.includes('\n')) {
    throw new Error(`${field} must not contain CR or LF characters`);
  }
}

function hasHeader(headers: Record<string, string>, headerName: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === headerName.toLowerCase());
}

function findHeaderValue(headers: ParsedHttpHeader[], headerName: string): string | null {
  const match = headers.find((header) => header.name.toLowerCase() === headerName.toLowerCase());
  return match?.value ?? null;
}

function isBodylessResponse(statusCode: number, requestMethod?: string): boolean {
  return (
    requestMethod?.toUpperCase() === 'HEAD' ||
    (statusCode >= 100 && statusCode < 200) ||
    statusCode === 204 ||
    statusCode === 304
  );
}

function findHeaderTerminator(buffer: Buffer): number | null {
  const crlf = buffer.indexOf('\r\n\r\n');
  if (crlf >= 0) {
    return crlf + 4;
  }

  const lf = buffer.indexOf('\n\n');
  if (lf >= 0) {
    return lf + 2;
  }

  return null;
}

function findLineBreak(
  buffer: Buffer,
  start: number,
): { lineEnd: number; nextOffset: number } | null {
  const lfIndex = buffer.indexOf(0x0a, start);
  if (lfIndex < 0) {
    return null;
  }

  const lineEnd = lfIndex > start && buffer[lfIndex - 1] === 0x0d ? lfIndex - 1 : lfIndex;
  return { lineEnd, nextOffset: lfIndex + 1 };
}

function decodeChunkedBody(buffer: Buffer): {
  complete: boolean;
  consumedBytes: number;
  body: Buffer;
} {
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const line = findLineBreak(buffer, offset);
    if (!line) {
      return { complete: false, consumedBytes: offset, body: Buffer.concat(chunks) };
    }

    const sizeLine = buffer.subarray(offset, line.lineEnd).toString('latin1').trim();
    const sizeToken = sizeLine.split(';', 1)[0]?.trim() ?? '';
    const chunkSize = Number.parseInt(sizeToken, 16);
    if (!Number.isFinite(chunkSize) || chunkSize < 0) {
      return { complete: false, consumedBytes: offset, body: Buffer.concat(chunks) };
    }

    if (chunkSize === 0) {
      const trailerSection = buffer.subarray(line.nextOffset);
      const trailerEnd = findHeaderTerminator(trailerSection);
      if (trailerEnd !== null) {
        return {
          complete: true,
          consumedBytes: line.nextOffset + trailerEnd,
          body: Buffer.concat(chunks),
        };
      }

      if (trailerSection.length >= 2 && trailerSection[0] === 0x0d && trailerSection[1] === 0x0a) {
        return {
          complete: true,
          consumedBytes: line.nextOffset + 2,
          body: Buffer.concat(chunks),
        };
      }

      if (trailerSection.length >= 1 && trailerSection[0] === 0x0a) {
        return {
          complete: true,
          consumedBytes: line.nextOffset + 1,
          body: Buffer.concat(chunks),
        };
      }

      return { complete: false, consumedBytes: offset, body: Buffer.concat(chunks) };
    }

    const dataStart = line.nextOffset;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > buffer.length) {
      return { complete: false, consumedBytes: offset, body: Buffer.concat(chunks) };
    }

    chunks.push(buffer.subarray(dataStart, dataEnd));

    const afterChunkLine = findLineBreak(buffer, dataEnd);
    if (!afterChunkLine || afterChunkLine.lineEnd !== dataEnd) {
      return { complete: false, consumedBytes: offset, body: Buffer.concat(chunks) };
    }

    offset = afterChunkLine.nextOffset;
  }

  return { complete: false, consumedBytes: offset, body: Buffer.concat(chunks) };
}

function buildHeaderSection(headers: Record<string, string>): string {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return '';
  }

  return `${entries.map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n`;
}

export function buildHttpRequest(input: HttpRequestBuildInput): BuiltHttpRequest {
  const method = input.method.trim().toUpperCase();
  const target = input.target.trim();
  const httpVersion = input.httpVersion ?? '1.1';

  if (!HEADER_NAME_RE.test(method)) {
    throw new Error('method must be a valid HTTP token');
  }
  if (target.length === 0) {
    throw new Error('target is required');
  }
  assertNoLineBreak(target, 'target');
  if (httpVersion !== '1.0' && httpVersion !== '1.1') {
    throw new Error('httpVersion must be either "1.0" or "1.1"');
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (!HEADER_NAME_RE.test(name)) {
      throw new Error(`Invalid HTTP header name: ${name}`);
    }
    if (typeof value !== 'string') {
      throw new Error(`HTTP header "${name}" must be a string`);
    }
    assertNoLineBreak(value, `headers.${name}`);
    headers[name] = value;
  }

  if (input.addHostHeader !== false && input.host && !hasHeader(headers, 'Host')) {
    assertNoLineBreak(input.host, 'host');
    headers.Host = input.host;
  }

  const body = input.body ?? '';
  const bodyProvided = input.body !== undefined;
  if (bodyProvided && input.addContentLength !== false && !hasHeader(headers, 'Content-Length')) {
    if (!hasHeader(headers, 'Transfer-Encoding')) {
      headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
    }
  }

  if (input.addConnectionClose !== false && !hasHeader(headers, 'Connection')) {
    headers.Connection = 'close';
  }

  const startLine = `${method} ${target} HTTP/${httpVersion}`;
  const requestText = `${startLine}\r\n${buildHeaderSection(headers)}\r\n${body}`;
  const requestBuffer = Buffer.from(requestText, 'utf8');

  return {
    requestText,
    requestHex: requestBuffer.toString('hex'),
    requestBytes: requestBuffer.length,
    startLine,
    headers,
    bodyBytes: Buffer.byteLength(body, 'utf8'),
    httpVersion,
  };
}

export function analyzeHttpResponse(
  rawResponse: Buffer,
  requestMethod?: string,
): ParsedHttpResponse | null {
  const headerBytes = findHeaderTerminator(rawResponse);
  if (headerBytes === null) {
    return null;
  }

  const headerBlock = rawResponse.subarray(0, headerBytes).toString('latin1');
  const headerLines = headerBlock
    .replace(/\r?\n\r?\n$/, '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  if (headerLines.length === 0) {
    throw new Error('HTTP response did not contain a status line');
  }

  const statusLine = headerLines[0]!;
  const statusMatch = /^HTTP\/(\d+\.\d+)\s+(\d{3})(?:\s+(.*))?$/.exec(statusLine);
  if (!statusMatch) {
    throw new Error(`Invalid HTTP status line: ${statusLine}`);
  }

  const rawHeaders: ParsedHttpHeader[] = [];
  const headers: Record<string, string> = {};
  for (const line of headerLines.slice(1)) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }

    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    rawHeaders.push({ name, value });
    if (!(name in headers)) {
      headers[name] = value;
    } else if (name.toLowerCase() === 'set-cookie') {
      headers[name] = `${headers[name]}, ${value}`;
    } else {
      headers[name] = `${headers[name]}, ${value}`;
    }
  }

  const statusCode = Number.parseInt(statusMatch[2]!, 10);
  const responseBody = rawResponse.subarray(headerBytes);

  if (isBodylessResponse(statusCode, requestMethod)) {
    return {
      statusLine,
      httpVersion: statusMatch[1]!,
      statusCode,
      statusText: statusMatch[3] ?? '',
      headers,
      rawHeaders,
      headerBytes,
      bodyBytes: 0,
      bodyBuffer: Buffer.alloc(0),
      bodyMode: 'none',
      complete: true,
      expectedRawBytes: headerBytes,
      chunkedDecoded: false,
    };
  }

  const transferEncoding = findHeaderValue(rawHeaders, 'transfer-encoding');
  if (transferEncoding?.toLowerCase().includes('chunked')) {
    const decoded = decodeChunkedBody(responseBody);
    return {
      statusLine,
      httpVersion: statusMatch[1]!,
      statusCode,
      statusText: statusMatch[3] ?? '',
      headers,
      rawHeaders,
      headerBytes,
      bodyBytes: decoded.body.length,
      bodyBuffer: decoded.complete ? decoded.body : responseBody,
      bodyMode: 'chunked',
      complete: decoded.complete,
      expectedRawBytes: decoded.complete ? headerBytes + decoded.consumedBytes : null,
      chunkedDecoded: decoded.complete,
    };
  }

  const contentLengthValue = findHeaderValue(rawHeaders, 'content-length');
  if (contentLengthValue !== null) {
    const contentLength = Number.parseInt(contentLengthValue, 10);
    if (Number.isFinite(contentLength) && contentLength >= 0) {
      const bodyBuffer = responseBody.subarray(0, Math.min(responseBody.length, contentLength));
      return {
        statusLine,
        httpVersion: statusMatch[1]!,
        statusCode,
        statusText: statusMatch[3] ?? '',
        headers,
        rawHeaders,
        headerBytes,
        bodyBytes: bodyBuffer.length,
        bodyBuffer,
        bodyMode: 'content-length',
        complete: responseBody.length >= contentLength,
        expectedRawBytes: headerBytes + contentLength,
        chunkedDecoded: false,
      };
    }
  }

  return {
    statusLine,
    httpVersion: statusMatch[1]!,
    statusCode,
    statusText: statusMatch[3] ?? '',
    headers,
    rawHeaders,
    headerBytes,
    bodyBytes: responseBody.length,
    bodyBuffer: responseBody,
    bodyMode: 'until-close',
    complete: false,
    expectedRawBytes: null,
    chunkedDecoded: false,
  };
}

export function isLikelyTextHttpBody(
  contentType: string | null | undefined,
  body: Buffer,
): boolean {
  if (body.length === 0) {
    return true;
  }

  if (contentType && TEXTUAL_CONTENT_TYPE_RE.test(contentType)) {
    return true;
  }

  const sample = body.subarray(0, Math.min(body.length, 64));
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
  }

  return true;
}
