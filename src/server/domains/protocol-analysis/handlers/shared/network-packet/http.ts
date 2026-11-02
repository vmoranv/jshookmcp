/**
 * HTTP/1.x message parser (RFC 7230).
 *
 * Decodes a raw HTTP request or response payload (single segment, not a
 * reassembled TCP stream) into structured fields with header parsing, chunked
 * transfer-encoding unwinding, and body decoding hints.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HttpMessageKind = 'request' | 'response';

export interface HttpHeader {
  name: string;
  value: string;
}

export interface ParsedHttpMessage {
  kind: HttpMessageKind;
  byteLength: number;
  startLine: string;
  method?: string;
  requestTarget?: string;
  httpVersion?: string;
  statusCode?: number;
  reasonPhrase?: string;
  headers: HttpHeader[];
  /** Same data as `headers` keyed by lower-cased name (last value wins). */
  headersByKey: Record<string, string>;
  bodyHex: string;
  /** Body after chunked transfer-encoding unwinding (null when not chunked). */
  decodedBodyHex: string | null;
  transferEncoding?: string;
  contentLength?: number;
  contentType?: string;
  contentEncoding?: string;
  host?: string;
  chunkCount: number | null;
  malformedChunks: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const CRLF = Buffer.from('\r\n');
const DOUBLE_CRLF = Buffer.from('\r\n\r\n');
const LF = Buffer.from('\n');

/** Parse head lines into header records plus a lowercase lookup map. */
function parseHttpHeadLines(
  lines: string[],
  warnings: string[],
): { headers: HttpHeader[]; headersByKey: Record<string, string> } {
  const headers: HttpHeader[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      warnings.push(`malformed header line: "${line}"`);
      continue;
    }
    const name = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (name.length === 0) {
      warnings.push(`empty header name in line: "${line}"`);
      continue;
    }
    headers.push({ name, value });
  }

  const headersByKey: Record<string, string> = {};
  for (const header of headers) {
    headersByKey[header.name.toLowerCase()] = header.value;
  }
  return { headers, headersByKey };
}

/** Extract HTTP version from a token ("HTTP/1.1" -> "1.1", verbatim otherwise). */
function httpVersionFromToken(token: string): string {
  return /^HTTP\/\d+(\.\d+)?$/iu.test(token) ? token.slice(5) : token;
}

function parseHttpRequestLine(
  startLine: string,
  result: ParsedHttpMessage,
  warnings: string[],
): void {
  const parts = startLine.split(/\s+/u);
  if (parts.length < 3) {
    warnings.push('malformed request line: expected "METHOD SP target SP HTTP-version"');
    return;
  }
  result.method = parts[0];
  result.requestTarget = parts.slice(1, -1).join(' ');
  result.httpVersion = httpVersionFromToken(parts[parts.length - 1]!);
}

function parseHttpStatusLine(
  startLine: string,
  result: ParsedHttpMessage,
  warnings: string[],
): void {
  const parts = startLine.split(/\s+/u);
  if (parts.length < 2) {
    warnings.push('malformed status line: expected "HTTP-version SP status-code [reason]"');
    return;
  }
  result.httpVersion = httpVersionFromToken(parts[0]!);
  const status = Number.parseInt(parts[1]!, 10);
  if (Number.isFinite(status)) {
    result.statusCode = status;
  }
  result.reasonPhrase = parts.slice(2).join(' ');
}

export function parseHttpMessage(payload: Buffer): ParsedHttpMessage {
  const warnings: string[] = [];
  const separatorEnd = indexOfSequence(payload, DOUBLE_CRLF);
  let headEnd: number;
  if (separatorEnd !== -1) {
    headEnd = separatorEnd + 2; // include trailing CRLF of last header
  } else {
    const lfEnd = indexOfSequence(payload, LF);
    if (lfEnd === -1) {
      throw new Error('HTTP payload missing a complete start line');
    }
    headEnd = lfEnd;
    warnings.push('malformed message: start line not terminated by CRLF');
  }

  const headText = payload.subarray(0, headEnd).toString('utf8');
  const body = payload.subarray(separatorEnd !== -1 ? separatorEnd + 4 : headEnd + 1);

  const lines = headText.split(/\r\n/u);
  const startLine = lines.shift()?.trim() ?? '';

  const { headers, headersByKey } = parseHttpHeadLines(lines, warnings);

  const kind: HttpMessageKind = /^HTTP\/\d/u.test(startLine) ? 'response' : 'request';
  const base: Omit<
    ParsedHttpMessage,
    'method' | 'requestTarget' | 'httpVersion' | 'statusCode' | 'reasonPhrase'
  > = {
    kind,
    byteLength: payload.length,
    startLine,
    headers,
    headersByKey,
    bodyHex: body.toString('hex'),
    decodedBodyHex: null,
    chunkCount: null,
    malformedChunks: [],
    warnings,
  };

  const result: ParsedHttpMessage = { ...base } as ParsedHttpMessage;

  const transferEncoding = headersByKey['transfer-encoding'];
  if (transferEncoding) {
    result.transferEncoding = transferEncoding;
  }

  const contentLengthHeader = headersByKey['content-length'];
  if (contentLengthHeader !== undefined) {
    const parsed = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      result.contentLength = parsed;
    }
  }

  if (headersByKey['content-type']) {
    result.contentType = headersByKey['content-type'];
  }
  if (headersByKey['content-encoding']) {
    result.contentEncoding = headersByKey['content-encoding'];
  }
  if (headersByKey['host']) {
    result.host = headersByKey['host'];
  }

  if (kind === 'request') {
    parseHttpRequestLine(startLine, result, warnings);
  } else {
    parseHttpStatusLine(startLine, result, warnings);
  }

  // Chunked transfer-encoding unwinding.
  if (transferEncoding && /chunked/iu.test(transferEncoding)) {
    const decoded = unwindChunked(body, result.malformedChunks, warnings);
    result.decodedBodyHex = decoded.body.toString('hex');
    result.chunkCount = decoded.chunkCount;
  }

  return result;
}

function unwindChunked(
  body: Buffer,
  malformed: string[],
  warnings: string[],
): { body: Buffer; chunkCount: number } {
  const parts: Buffer[] = [];
  let cursor = 0;
  let chunkCount = 0;

  while (cursor < body.length) {
    const lineEnd = indexOfSequence(body, CRLF, cursor);
    if (lineEnd === -1) {
      malformed.push(`no CRLF after chunk size at offset ${cursor}`);
      break;
    }
    const sizeLine = body.subarray(cursor, lineEnd).toString('ascii');
    const sizeToken = sizeLine.split(';')[0]!.trim();
    if (sizeToken.length === 0) {
      malformed.push(`empty chunk size token at offset ${cursor}`);
      break;
    }
    const size = Number.parseInt(sizeToken, 16);
    if (!Number.isFinite(size) || size < 0) {
      malformed.push(`invalid chunk size "${sizeToken}" at offset ${cursor}`);
      break;
    }
    cursor = lineEnd + 2;

    if (size === 0) {
      // Terminating zero-length chunk signals end of body; not a data chunk.
      break;
    }

    if (cursor + size > body.length) {
      malformed.push(`chunk body of size ${size} exceeds remaining body at offset ${cursor}`);
      break;
    }
    parts.push(body.subarray(cursor, cursor + size));
    cursor += size;
    if (cursor + 2 <= body.length) {
      cursor += 2; // skip trailing CRLF
    } else {
      warnings.push('chunked body missing trailing CRLF after chunk');
      break;
    }
    chunkCount++;
  }

  return { body: Buffer.concat(parts), chunkCount };
}

function indexOfSequence(haystack: Buffer, needle: Buffer, from = 0): number {
  if (needle.length === 0) return from;
  for (let i = from; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}
