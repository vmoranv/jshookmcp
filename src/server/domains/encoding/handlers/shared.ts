/**
 * Encoding domain shared types, constants, and utility functions.
 * Extracted from EncodingHandlersBase.
 */

import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { CodeCollector } from '@server/domains/shared/modules';

export type DetectSource = 'base64' | 'hex' | 'file' | 'raw';
export type EntropySource = 'base64' | 'hex' | 'raw' | 'file';
export type DecodeEncoding = 'base64' | 'hex' | 'url' | 'protobuf' | 'msgpack';
export type OutputFormat = 'hex' | 'utf8' | 'json';
export type InputFormat = 'utf8' | 'hex' | 'json';
export type OutputEncoding = 'base64' | 'hex' | 'url';
export type EntropyAssessment = 'plaintext' | 'encoded' | 'compressed' | 'encrypted' | 'random';

export interface MagicSignature {
  readonly format: string;
  readonly bytes: readonly number[];
}
export interface ByteFrequencyEntry {
  byte: string;
  count: number;
  ratio: number;
}

export const MAGIC_SIGNATURES = [
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'gif', bytes: [0x47, 0x49, 0x46] },
  { format: 'wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
  { format: 'zip/apk', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { format: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
] satisfies ReadonlyArray<MagicSignature>;

export const DETECT_SOURCE_SET: ReadonlySet<DetectSource> = new Set([
  'base64',
  'hex',
  'file',
  'raw',
]);
export const ENTROPY_SOURCE_SET: ReadonlySet<EntropySource> = new Set([
  'base64',
  'hex',
  'raw',
  'file',
]);
export const DECODE_ENCODING_SET: ReadonlySet<DecodeEncoding> = new Set([
  'base64',
  'hex',
  'url',
  'protobuf',
  'msgpack',
]);
export const OUTPUT_FORMAT_SET: ReadonlySet<OutputFormat> = new Set(['hex', 'utf8', 'json']);
export const INPUT_FORMAT_SET: ReadonlySet<InputFormat> = new Set(['utf8', 'hex', 'json']);
export const OUTPUT_ENCODING_SET: ReadonlySet<OutputEncoding> = new Set(['base64', 'hex', 'url']);

// ── Response helpers ──

export function ok(payload: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

export function fail(tool: string, error: unknown) {
  return ok({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
  });
}

// ── String / encoding utilities ──

export function decodeHexString(value: string): Buffer {
  const cleaned = value
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s:,-]/g, '');
  if (cleaned.length === 0) return Buffer.alloc(0);
  if (cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned))
    throw new Error('Invalid hex string');
  return Buffer.from(cleaned, 'hex');
}

export function decodeBase64String(value: string): Buffer {
  const cleaned = value.trim().replace(/\s+/g, '');
  if (cleaned.length === 0) return Buffer.alloc(0);
  if (!looksLikeBase64(cleaned)) throw new Error('Invalid base64 string');
  return Buffer.from(cleaned, 'base64');
}

export function decodeBinaryAuto(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.length === 0) return Buffer.alloc(0);
  if (looksLikeHex(trimmed)) return decodeHexString(trimmed);
  if (looksLikeBase64(trimmed)) return decodeBase64String(trimmed);
  return Buffer.from(trimmed, 'utf8');
}

export function looksLikeHex(value: string): boolean {
  const cleaned = value
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s:,-]/g, '');
  return cleaned.length > 0 && cleaned.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(cleaned);
}

export function looksLikeBase64(value: string): boolean {
  const cleaned = value.trim().replace(/\s+/g, '');
  if (cleaned.length === 0 || cleaned.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) return false;
  try {
    const decoded = Buffer.from(cleaned, 'base64');
    return cleaned.replace(/=+$/, '') === decoded.toString('base64').replace(/=+$/, '');
  } catch {
    return false;
  }
}

export function looksLikeUrlEncoded(value: string): boolean {
  return /%[0-9a-fA-F]{2}/.test(value) || /\+/.test(value);
}

export function decodeUrl(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, '%20'));
}

export function encodeUrlBytes(buffer: Buffer): string {
  let encoded = '';
  for (const value of buffer.values()) {
    const isAlphaNum =
      (value >= 0x30 && value <= 0x39) ||
      (value >= 0x41 && value <= 0x5a) ||
      (value >= 0x61 && value <= 0x7a);
    const isUnreserved = value === 0x2d || value === 0x2e || value === 0x5f || value === 0x7e;
    encoded +=
      isAlphaNum || isUnreserved
        ? String.fromCharCode(value)
        : `%${value.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return encoded;
}

export function toSafeUtf8(buffer: Buffer): string | null {
  const text = buffer.toString('utf8');
  if ((text.match(/\uFFFD/g) ?? []).length > 0) return null;
  return text;
}

export function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function previewHex(buffer: Buffer, maxBytes: number): string {
  return Array.from(buffer.subarray(0, maxBytes).values())
    .map((v) => v.toString(16).padStart(2, '0'))
    .join(' ');
}

export function hexDump(buffer: Buffer, bytesPerRow = 16): string {
  const lines: string[] = [];
  for (let offset = 0; offset < buffer.length; offset += bytesPerRow) {
    const row = buffer.subarray(offset, offset + bytesPerRow);
    const hex = Array.from(row.values())
      .map((v) => v.toString(16).padStart(2, '0'))
      .join(' ');
    const ascii = Array.from(row.values())
      .map((v) => (v >= 0x20 && v <= 0x7e ? String.fromCharCode(v) : '.'))
      .join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  return lines.join('\n');
}

// ── Output rendering ──

export function renderDecodedOutput(params: {
  encoding: DecodeEncoding;
  outputFormat: OutputFormat;
  buffer: Buffer;
  jsonValue?: unknown;
}) {
  const { encoding, outputFormat, buffer, jsonValue } = params;
  if (outputFormat === 'hex')
    return ok({
      success: true,
      encoding,
      outputFormat,
      byteLength: buffer.length,
      result: buffer.toString('hex'),
      hexDump: hexDump(buffer),
    });
  if (outputFormat === 'utf8')
    return ok({
      success: true,
      encoding,
      outputFormat,
      byteLength: buffer.length,
      result: buffer.toString('utf8'),
    });
  const utf8 = toSafeUtf8(buffer);
  const maybeJson = utf8 === null ? null : tryParseJson(utf8);
  return ok({
    success: true,
    encoding,
    outputFormat,
    byteLength: buffer.length,
    result: jsonValue ?? { parsedJson: maybeJson, utf8, hex: buffer.toString('hex') },
  });
}

// ── Buffer resolution ──

export async function resolveBufferBySource(options: {
  source: DetectSource | EntropySource;
  data?: string;
  filePath?: string;
  maxBytes?: number;
}): Promise<Buffer> {
  const { source, data, filePath, maxBytes } = options;
  if (source === 'file') {
    if (!filePath) throw new Error('filePath is required when source=file');
    const resolved = resolve(filePath);
    const real = await realpath(resolved);
    const allowedRoots = await Promise.all(
      [tmpdir(), homedir(), process.cwd()].map(async (p) => {
        const absolute = isAbsolute(p) ? p : resolve(p);
        try {
          return await realpath(absolute);
        } catch {
          return absolute;
        }
      }),
    );
    if (!allowedRoots.some((root) => real.startsWith(root)))
      throw new Error(`File access denied: path "${filePath}" is outside allowed directories`);
    const fileBuffer = await readFile(real);
    return typeof maxBytes === 'number' ? fileBuffer.subarray(0, maxBytes) : fileBuffer;
  }
  if (source === 'base64') {
    if (!data) throw new Error('data is required for base64 source');
    return decodeBase64String(data);
  }
  if (source === 'hex') {
    if (!data) throw new Error('data is required for hex source');
    return decodeHexString(data);
  }
  return Buffer.from(data ?? '', 'utf8');
}

export async function resolveRequestBodyFromActivePage(
  collector: CodeCollector,
  requestId: string,
): Promise<Buffer | null> {
  try {
    const page = await collector.getActivePage();
    const result = await page.evaluate((targetRequestId: string) => {
      const pickBody = (entry: unknown): { body: string; base64Encoded: boolean } | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        if (record.requestId !== targetRequestId) return null;
        if (typeof record.responseBody === 'string')
          return { body: record.responseBody, base64Encoded: Boolean(record.base64Encoded) };
        if (typeof record.body === 'string')
          return { body: record.body, base64Encoded: Boolean(record.base64Encoded) };
        const response = record.response;
        if (response && typeof response === 'object') {
          const rr = response as Record<string, unknown>;
          if (typeof rr.body === 'string')
            return { body: rr.body, base64Encoded: Boolean(rr.base64Encoded) };
        }
        return null;
      };
      const searchArray = (payload: unknown): { body: string; base64Encoded: boolean } | null => {
        if (!Array.isArray(payload)) return null;
        for (const item of payload) {
          const found = pickBody(item);
          if (found) return found;
        }
        return null;
      };
      const win = window as unknown as Record<string, unknown>;
      const fromMemory = searchArray(win.__capturedAPIs);
      if (fromMemory) return fromMemory;
      try {
        const raw = window.localStorage.getItem('__capturedAPIs');
        if (!raw) return null;
        return searchArray(JSON.parse(raw));
      } catch {
        return null;
      }
    }, requestId);
    if (!result || typeof result !== 'object') return null;
    const payload = result as { body?: string; base64Encoded?: boolean };
    if (typeof payload.body !== 'string') return null;
    if (payload.base64Encoded) return Buffer.from(payload.body, 'base64');
    const maybeBase64 = payload.body.trim();
    if (looksLikeBase64(maybeBase64)) return Buffer.from(maybeBase64, 'base64');
    return Buffer.from(payload.body, 'utf8');
  } catch {
    return null;
  }
}

// ── Analysis utilities ──

export function detectMagicFormats(buffer: Buffer): string[] {
  const matches: string[] = [];
  for (const signature of MAGIC_SIGNATURES) {
    if (buffer.length < signature.bytes.length) continue;
    let matched = true;
    for (let i = 0; i < signature.bytes.length; i += 1) {
      if (buffer[i] !== signature.bytes[i]) {
        matched = false;
        break;
      }
    }
    if (matched) matches.push(signature.format);
  }
  return matches;
}

export function detectStructuredFormats(buffer: Buffer): string[] {
  const firstByte = buffer[0];
  if (firstByte === undefined) return [];
  const formats = new Set<string>();
  if ([0x08, 0x10, 0x18, 0x20].includes(firstByte)) formats.add('protobuf');
  if (
    (firstByte >= 0x80 && firstByte <= 0x8f) ||
    (firstByte >= 0x90 && firstByte <= 0x9f) ||
    (firstByte >= 0xa0 && firstByte <= 0xbf)
  )
    formats.add('messagepack');
  if ((firstByte >= 0xa0 && firstByte <= 0xbf) || (firstByte >= 0x80 && firstByte <= 0x9f))
    formats.add('cbor');
  return Array.from(formats);
}

export function detectEncodingSignals(
  source: DetectSource,
  data: string | undefined,
  buffer: Buffer,
): string[] {
  const encodings = new Set<string>();
  if (source === 'base64' || (data && looksLikeBase64(data.trim()))) encodings.add('base64');
  if (source === 'hex' || (data && looksLikeHex(data))) encodings.add('hex');
  if (data && looksLikeUrlEncoded(data)) encodings.add('url-encoded');
  if (buffer.length >= 3) {
    const [a, b, c] = buffer;
    if (a === 0xef && b === 0xbb && c === 0xbf) encodings.add('utf8-bom');
  }
  return Array.from(encodings);
}

export function calculateShannonEntropy(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  const freq: number[] = Array.from({ length: 256 }, () => 0);
  for (const value of buffer.values()) freq[value]! += 1;
  let entropy = 0;
  for (const count of freq) {
    if (count === 0) continue;
    const p = count / buffer.length;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(6));
}

export function calculateByteFrequency(buffer: Buffer): ByteFrequencyEntry[] {
  if (buffer.length === 0) return [];
  const freq: number[] = Array.from({ length: 256 }, () => 0);
  for (const value of buffer.values()) freq[value]! += 1;
  const entries: ByteFrequencyEntry[] = [];
  for (let v = 0; v < 256; v += 1) {
    const count = freq[v]!;
    if (count === 0) continue;
    entries.push({
      byte: `0x${v.toString(16).padStart(2, '0')}`,
      count,
      ratio: Number((count / buffer.length).toFixed(6)),
    });
  }
  entries.sort((a, b) => b.count - a.count);
  return entries;
}

export function calculateBlockEntropies(
  buffer: Buffer,
  blockSize: number,
): Array<{ index: number; start: number; end: number; entropy: number }> {
  if (buffer.length === 0) return [];
  const blocks: Array<{ index: number; start: number; end: number; entropy: number }> = [];
  let index = 0;
  for (let start = 0; start < buffer.length; start += blockSize) {
    const end = Math.min(start + blockSize, buffer.length);
    blocks.push({
      index,
      start,
      end,
      entropy: calculateShannonEntropy(buffer.subarray(start, end)),
    });
    index += 1;
  }
  return blocks;
}

export function assessEntropy(entropy: number, buffer: Buffer): EntropyAssessment {
  const ratio = printableRatio(buffer);
  if (entropy < 3.8 && ratio > 0.85) return 'plaintext';
  if (entropy < 5.8) return 'encoded';
  if (entropy < 7.2) return 'compressed';
  if (entropy < 7.8) return 'encrypted';
  return 'random';
}

function printableRatio(buffer: Buffer): number {
  if (buffer.length === 0) return 1;
  let printable = 0;
  for (const value of buffer.values()) {
    if ((value >= 0x20 && value <= 0x7e) || value === 0x09 || value === 0x0a || value === 0x0d)
      printable += 1;
  }
  return printable / buffer.length;
}
