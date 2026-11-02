/**
 * Encoding domain shared types, constants, and utility functions.
 * Extracted from EncodingHandlersBase.
 */

import { readFile, realpath } from 'node:fs/promises';
import { MAGIC_SIGNATURES } from '@server/domains/encoding/handlers.impl.core.runtime.shared';
import { isAbsolute, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { CodeCollector } from '@server/domains/shared/modules/collector';

export type DetectSource = 'base64' | 'hex' | 'file' | 'raw';
export type EntropySource = 'base64' | 'hex' | 'raw' | 'file';
export type DecodeEncoding =
  | 'base64'
  | 'base32'
  | 'base32hex'
  | 'base32-crockford'
  | 'base58'
  | 'base85'
  | 'hex'
  | 'url'
  | 'gzip'
  | 'zlib'
  | 'deflate'
  | 'brotli'
  | 'protobuf'
  | 'msgpack';
export type OutputFormat = 'hex' | 'utf8' | 'json';
export type InputFormat = 'utf8' | 'hex' | 'json';
export type OutputEncoding =
  | 'base64'
  | 'base32'
  | 'base32hex'
  | 'base32-crockford'
  | 'base58'
  | 'base85'
  | 'hex'
  | 'url'
  | 'gzip'
  | 'zlib'
  | 'deflate'
  | 'brotli';
export type EntropyAssessment = 'plaintext' | 'encoded' | 'compressed' | 'encrypted' | 'random';

export interface MagicSignature {
  readonly format: string;
  readonly bytes: readonly number[];
  readonly offset?: number;
}
export interface ByteFrequencyEntry {
  byte: string;
  count: number;
  ratio: number;
}

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
  'base32',
  'base32hex',
  'base32-crockford',
  'base58',
  'base85',
  'hex',
  'url',
  'gzip',
  'zlib',
  'deflate',
  'brotli',
  'protobuf',
  'msgpack',
]);
export const OUTPUT_FORMAT_SET: ReadonlySet<OutputFormat> = new Set(['hex', 'utf8', 'json']);
export const INPUT_FORMAT_SET: ReadonlySet<InputFormat> = new Set(['utf8', 'hex', 'json']);
export const OUTPUT_ENCODING_SET: ReadonlySet<OutputEncoding> = new Set([
  'base64',
  'base32',
  'base32hex',
  'base32-crockford',
  'base58',
  'base85',
  'hex',
  'url',
  'gzip',
  'zlib',
  'deflate',
  'brotli',
]);

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

const BASE32_ALPHABETS = {
  base32: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
  base32hex: '0123456789ABCDEFGHIJKLMNOPQRSTUV',
  'base32-crockford': '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
} as const;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ASCII85_OFFSET = 33;
const ASCII85_BASE = 85;

export function encodeBase32Bytes(
  buffer: Buffer,
  variant: 'base32' | 'base32hex' | 'base32-crockford' = 'base32',
): string {
  const alphabet = BASE32_ALPHABETS[variant];
  if (buffer.length === 0) return '';
  let output = '';
  let value = 0;
  let bits = 0;
  for (const byte of buffer.values()) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 0x1f];
  if (variant !== 'base32-crockford') {
    while (output.length % 8 !== 0) output += '=';
  }
  return output;
}

export function decodeBase32String(
  input: string,
  variant: 'base32' | 'base32hex' | 'base32-crockford' = 'base32',
): Buffer {
  const alphabet = BASE32_ALPHABETS[variant];
  const lookup = new Map<string, number>();
  for (let index = 0; index < alphabet.length; index += 1) {
    lookup.set(alphabet[index]!, index);
  }

  let normalized = input.trim().replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase();
  if (variant === 'base32-crockford') {
    normalized = normalized.replace(/[IL]/g, '1').replace(/O/g, '0');
  }
  if (normalized.length === 0) return Buffer.alloc(0);

  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of normalized) {
    const decoded = lookup.get(char);
    if (decoded === undefined) throw new Error(`Invalid ${variant} character: ${char}`);
    value = (value << 5) | decoded;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && value !== 0) throw new Error(`Invalid ${variant} padding bits`);
  return Buffer.from(bytes);
}

export function encodeBase58Bytes(buffer: Buffer): string {
  if (buffer.length === 0) return '';
  let zeroes = 0;
  while (zeroes < buffer.length && buffer[zeroes] === 0) zeroes += 1;

  let value = 0n;
  for (const byte of buffer.values()) value = (value << 8n) | BigInt(byte);

  let output = '';
  while (value > 0n) {
    const mod = Number(value % 58n);
    output = BASE58_ALPHABET[mod]! + output;
    value /= 58n;
  }
  return `${'1'.repeat(zeroes)}${output}`;
}

export function decodeBase58String(input: string): Buffer {
  const normalized = input.trim();
  if (normalized.length === 0) return Buffer.alloc(0);

  let value = 0n;
  for (const char of normalized) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit === -1) throw new Error(`Invalid base58 character: ${char}`);
    value = value * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }

  let leadingZeroes = 0;
  while (leadingZeroes < normalized.length && normalized[leadingZeroes] === '1') {
    leadingZeroes += 1;
  }
  return Buffer.from([...Array.from({ length: leadingZeroes }, () => 0), ...bytes]);
}

export function encodeAscii85Bytes(buffer: Buffer): string {
  if (buffer.length === 0) return '';
  let output = '';
  for (let offset = 0; offset < buffer.length; offset += 4) {
    const chunk = buffer.subarray(offset, offset + 4);
    const padded = Buffer.alloc(4);
    chunk.copy(padded);
    const value = padded.readUInt32BE(0);
    if (chunk.length === 4 && value === 0) {
      output += 'z';
      continue;
    }

    const chars = Array.from({ length: 5 }, () => 0);
    let remaining = value;
    for (let index = 4; index >= 0; index -= 1) {
      chars[index] = (remaining % ASCII85_BASE) + ASCII85_OFFSET;
      remaining = Math.floor(remaining / ASCII85_BASE);
    }
    output += String.fromCharCode(...chars.slice(0, chunk.length + 1));
  }
  return output;
}

export function decodeAscii85String(input: string): Buffer {
  const normalized = input.trim().replace(/^<~/, '').replace(/~>$/, '').replace(/\s+/g, '');
  if (normalized.length === 0) return Buffer.alloc(0);

  const bytes: number[] = [];
  let tuple: number[] = [];
  const flush = (final = false): void => {
    if (tuple.length === 0) return;
    if (tuple.length === 1) throw new Error('Invalid base85 tuple length');
    const originalLength = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let value = 0;
    for (const digit of tuple) value = value * ASCII85_BASE + digit;
    const chunk = Buffer.alloc(4);
    chunk.writeUInt32BE(value >>> 0, 0);
    bytes.push(...chunk.subarray(0, final ? originalLength - 1 : 4));
    tuple = [];
  };

  for (const char of normalized) {
    if (char === 'z') {
      if (tuple.length !== 0) throw new Error('Invalid base85 zero tuple position');
      bytes.push(0, 0, 0, 0);
      continue;
    }
    const code = char.charCodeAt(0);
    if (code < 33 || code > 117) throw new Error(`Invalid base85 character: ${char}`);
    tuple.push(code - ASCII85_OFFSET);
    if (tuple.length === 5) flush(false);
  }
  flush(true);
  return Buffer.from(bytes);
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

/**
 * Hex response amplification guard: hex output is ~2x the buffer size and the
 * accompanying hex dump ~4-5x, so a large decompressed buffer would blow the
 * response many times over. When the buffer exceeds this cap, the hex result
 * and dump are sampled to the first 1MB and flagged `truncated`.
 */
const HEX_OUTPUT_MAX_BYTES = 1024 * 1024;

export function renderDecodedOutput(params: {
  encoding: DecodeEncoding;
  outputFormat: OutputFormat;
  buffer: Buffer;
  jsonValue?: unknown;
}) {
  const { encoding, outputFormat, buffer, jsonValue } = params;
  if (outputFormat === 'hex') {
    const truncated = buffer.length > HEX_OUTPUT_MAX_BYTES;
    const sampled = truncated ? buffer.subarray(0, HEX_OUTPUT_MAX_BYTES) : buffer;
    return ok({
      success: true,
      encoding,
      outputFormat,
      byteLength: buffer.length,
      ...(truncated
        ? { truncated: true, truncatedBytes: buffer.length - HEX_OUTPUT_MAX_BYTES }
        : {}),
      result: sampled.toString('hex'),
      hexDump: hexDump(sampled),
    });
  }
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
    // Separator-aware prefix check: startsWith alone lets a sibling directory
    // (e.g. `<root>2/x`) pass, since `<root>2` is a string prefix of `<root>`.
    const isAllowed = allowedRoots.some(
      (root) => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep),
    );
    if (!isAllowed)
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
    const offset = signature.offset ?? 0;
    if (buffer.length < offset + signature.bytes.length) continue;
    let matched = true;
    for (let i = 0; i < signature.bytes.length; i += 1) {
      if (buffer[offset + i] !== signature.bytes[i]) {
        matched = false;
        break;
      }
    }
    if (matched) matches.push(signature.format);
  }
  if (buffer.length >= 2 && buffer[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buffer[1]!)) {
    matches.push('zlib');
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

/**
 * Chi-square goodness-of-fit against a uniform byte distribution.
 * Low (~0) = bytes look uniformly distributed; high = skewed (structured/repeating).
 * For N bytes the expected count per bucket is N/256; χ² = Σ (O−E)²/E.
 * Pairs with Shannon entropy: a gzip stream or PNG IDAT can show high Shannon
 * but a skewed chi-square revealing it is not cryptographically random.
 */
export function calculateChiSquare(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  const freq: number[] = Array.from({ length: 256 }, () => 0);
  for (const value of buffer.values()) freq[value]! += 1;
  const expected = buffer.length / 256;
  let chiSquare = 0;
  for (let byte = 0; byte < 256; byte += 1) {
    const diff = freq[byte]! - expected;
    chiSquare += (diff * diff) / expected;
  }
  return Number(chiSquare.toFixed(6));
}

/**
 * Serial correlation coefficient (ENT-style) of adjacent bytes.
 * Range roughly −1..1: random data ≈ 0; strongly structured/periodic data
 * approaches ±1 (e.g. a monotonic counter → near +1). Needs ≥2 bytes.
 */
export function calculateSerialCorrelation(buffer: Buffer): number {
  if (buffer.length < 2) return 0;
  const n = buffer.length;
  let sumAdjacent = 0; // Σ b[i]·b[i+1] over the n−1 adjacent pairs
  let sumSquares = 0; // Σ b[i]² over all n bytes
  let sumFirst = 0; // Σ b[i] for i = 0..n−2
  let sumSecond = 0; // Σ b[i] for i = 1..n−1
  for (let i = 0; i < n - 1; i += 1) {
    const current = buffer[i]!;
    const next = buffer[i + 1]!;
    sumAdjacent += current * next;
    sumSquares += current * current;
    sumFirst += current;
    sumSecond += next;
  }
  sumSquares += buffer[n - 1]! * buffer[n - 1]!;
  const denominator = n * sumSquares - sumFirst * sumFirst;
  if (denominator === 0) return 0;
  const numerator = n * sumAdjacent - sumFirst * sumSecond;
  return Number((numerator / denominator).toFixed(6));
}

export function printableRatio(buffer: Buffer): number {
  if (buffer.length === 0) return 1;
  let printable = 0;
  for (const value of buffer.values()) {
    if ((value >= 0x20 && value <= 0x7e) || value === 0x09 || value === 0x0a || value === 0x0d)
      printable += 1;
  }
  return printable / buffer.length;
}

/** True when >=90% of chars are printable ASCII/whitespace (exact port of the former EncodingHandlersBase helper). */
export function isMostlyPrintableText(text: string): boolean {
  if (text.length === 0) {
    return true;
  }

  let printable = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code >= 0x20 && code <= 0x7e) || code === 0x09 || code === 0x0a || code === 0x0d) {
      printable++;
    }
  }
  return printable / text.length >= 0.85;
}
