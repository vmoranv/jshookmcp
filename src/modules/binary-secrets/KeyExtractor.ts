/**
 * KeyExtractor — scan a binary file for hardcoded key candidates.
 *
 * The extractor produces three flavours of candidate:
 *
 *  - `raw`     — sliding window of `keyLengths` bytes whose Shannon
 *                entropy meets the configured floor.
 *  - `base64`  — runs of `[A-Za-z0-9+/]` (with optional `=` padding)
 *                whose decoded byte length matches a `keyLengths` entry.
 *  - `hex`     — runs of `[0-9A-Fa-f]` of even length whose decoded
 *                byte length matches a `keyLengths` entry.
 *
 * No payload is ever executed. No bytes are written. The extractor
 * never attempts to verify whether a candidate is a real key — that is
 * the human reviewer's job. The output schema deliberately names every
 * field "candidate" rather than "key" to reinforce this.
 *
 * Streaming: the file is read in fixed-size chunks (`maxChunkBytes`)
 * with a tail-overlap (`BINARY_SECRETS_CHUNK_OVERLAP_BYTES`) so that
 * candidates straddling a chunk boundary are still detected.
 *
 * ReDoS dual-line: the Base64 and Hex scanners are NOT regex-driven —
 * they use byte-by-byte state machines so a malicious input cannot
 * trigger catastrophic backtracking. Length caps (`MAX_BASE64_LENGTH`,
 * `MAX_HEX_LENGTH`) put an additional hard ceiling on per-run cost.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

import { ToolError } from '@errors/ToolError';

import {
  BINARY_SECRETS_CHUNK_OVERLAP_BYTES,
  BINARY_SECRETS_CONTEXT_BYTES,
  BINARY_SECRETS_DEFAULT_KEY_LENGTHS,
  BINARY_SECRETS_MAX_BASE64_LENGTH,
  BINARY_SECRETS_MAX_CHUNK_BYTES,
  BINARY_SECRETS_MAX_EXTRACT_DURATION_MS,
  BINARY_SECRETS_MAX_HEX_LENGTH,
  BINARY_SECRETS_MAX_RESULTS,
  BINARY_SECRETS_MIN_BASE64_LENGTH,
  BINARY_SECRETS_MIN_ENTROPY_X10,
  BINARY_SECRETS_MIN_HEX_LENGTH,
  BINARY_SECRETS_VALUE_PREVIEW_BYTES,
} from './constants';
import { shannonEntropy, slidingEntropy } from './entropy';
import type {
  ExtractKeysOptions,
  ExtractKeysResult,
  KeyCandidate,
  KeyCandidateContext,
  KeyFormat,
} from './types';

interface RawHit {
  /** Absolute byte offset in the source file. */
  readonly absOffset: number;
  /** Decoded byte length. */
  readonly length: number;
  readonly format: KeyFormat;
  /** Decoded bytes (referenced view; do not retain across chunk reads). */
  readonly bytes: Uint8Array;
}

/** Default chunk size (used when caller omits `maxChunkBytes`). */
const DEFAULT_CHUNK = BINARY_SECRETS_MAX_CHUNK_BYTES;

const MIN_PRINTABLE = 0x20;
const MAX_PRINTABLE = 0x7e;

export class KeyExtractor {
  /**
   * Scan `filePath` for hardcoded key candidates.
   *
   * Throws {@link ToolError}(`VALIDATION`) for malformed options and
   * {@link ToolError}(`NOT_FOUND`) when the file cannot be opened.
   */
  async extractFromFile(
    filePath: string,
    opts: ExtractKeysOptions = {},
  ): Promise<ExtractKeysResult> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new ToolError('VALIDATION', 'filePath must be a non-empty string');
    }
    let totalSize = 0;
    try {
      const s = await stat(filePath);
      totalSize = s.size;
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `File not found: ${filePath}`, {
        details: { filePath },
        cause: cause as Error,
      });
    }

    const cfg = normalizeOptions(opts);
    const tStart = performance.now();

    const windowStart = Math.max(0, Math.min(cfg.scanWindowStart, totalSize));
    const windowEnd = Math.max(windowStart, Math.min(cfg.scanWindowEnd, totalSize));
    const expectedScannedBytes = windowEnd - windowStart;

    const hits: RawHit[] = [];
    const seen = new Set<string>();

    if (expectedScannedBytes === 0) {
      return {
        candidates: [],
        scannedBytes: 0,
        durationMs: performance.now() - tStart,
      };
    }

    let pending: Buffer = Buffer.alloc(0);
    let pendingStart = windowStart;
    let nextAbs = windowStart;

    const stream = createReadStream(filePath, {
      highWaterMark: cfg.maxChunkBytes,
      start: windowStart,
      end: windowEnd - 1, // createReadStream end is inclusive
    });

    for await (const raw of stream) {
      if (performance.now() - tStart > BINARY_SECRETS_MAX_EXTRACT_DURATION_MS) {
        throw new ToolError(
          'TIMEOUT',
          `binary_key_extract exceeded BINARY_SECRETS_MAX_EXTRACT_DURATION_MS (${BINARY_SECRETS_MAX_EXTRACT_DURATION_MS} ms)`,
        );
      }
      const chunk = raw as Buffer;
      const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

      scanChunk(combined, pendingStart, cfg, (hit) => {
        const key = `${hit.format}@${hit.absOffset}:${hit.length}`;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push(hit);
      });

      nextAbs += chunk.length;
      const keep = Math.min(combined.length, cfg.overlapBytes);
      // Copy the tail into a stand-alone buffer so the streaming chunk
      // can be released (Buffer.concat keeps the underlying ArrayBuffer
      // live which would defeat the streaming aspect).
      pending = Buffer.from(combined.subarray(combined.length - keep));
      pendingStart = nextAbs - keep;
    }

    // Sort by entropy desc, then offset asc.
    const scored = hits.map((h) => ({
      hit: h,
      entropy: shannonEntropy(h.bytes, 0, h.length),
    }));
    scored.sort((a, b) => {
      if (a.entropy !== b.entropy) return b.entropy - a.entropy;
      return a.hit.absOffset - b.hit.absOffset;
    });

    const truncated = scored.length > cfg.maxResults;
    const top = truncated ? scored.slice(0, cfg.maxResults) : scored;

    // Materialize ASCII/hex previews & context. The current implementation
    // re-reads the file lazily for context windows that fall outside the
    // hit's bytes — for the common case (context inside the current chunk
    // is unavailable post-streaming), we synthesise context from each
    // hit's already-captured bytes plus a re-stat fallback.
    const candidates = await materializeCandidates(filePath, top, cfg, totalSize);

    const result: ExtractKeysResult = {
      candidates,
      scannedBytes: expectedScannedBytes,
      durationMs: performance.now() - tStart,
      ...(truncated ? { truncated: true } : {}),
    };
    return result;
  }
}

/* ── Option normalization ─────────────────────────────────────────── */

interface NormalizedConfig {
  readonly keyLengths: readonly number[];
  readonly maxRawWindow: number;
  readonly minRawWindow: number;
  readonly minEntropy: number;
  readonly formats: ReadonlySet<KeyFormat>;
  readonly includeContext: boolean;
  readonly contextBytes: number;
  readonly maxResults: number;
  readonly maxChunkBytes: number;
  readonly overlapBytes: number;
  readonly scanWindowStart: number;
  readonly scanWindowEnd: number;
}

function normalizeOptions(opts: ExtractKeysOptions): NormalizedConfig {
  const keyLengths = (() => {
    if (!opts.keyLengths) return BINARY_SECRETS_DEFAULT_KEY_LENGTHS;
    if (!Array.isArray(opts.keyLengths)) {
      throw new ToolError('VALIDATION', 'keyLengths must be an array of positive integers');
    }
    const cleaned = opts.keyLengths
      .map((n) => {
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          throw new ToolError(
            'VALIDATION',
            `keyLengths entries must be positive integers (got ${String(n)})`,
          );
        }
        return n;
      })
      .filter((n, i, arr) => arr.indexOf(n) === i);
    if (cleaned.length === 0) {
      throw new ToolError('VALIDATION', 'keyLengths must contain at least one positive integer');
    }
    return cleaned;
  })();

  const minEntropy = (() => {
    if (opts.minEntropy === undefined) return BINARY_SECRETS_MIN_ENTROPY_X10 / 10;
    if (typeof opts.minEntropy !== 'number' || !Number.isFinite(opts.minEntropy)) {
      throw new ToolError('VALIDATION', 'minEntropy must be a finite number in [0, 8]');
    }
    if (opts.minEntropy < 0 || opts.minEntropy > 8) {
      throw new ToolError('VALIDATION', `minEntropy must be in [0, 8] (got ${opts.minEntropy})`);
    }
    return opts.minEntropy;
  })();

  const formats = new Set<KeyFormat>(opts.formats ?? ['raw', 'base64', 'hex']);
  for (const f of formats) {
    if (f !== 'raw' && f !== 'base64' && f !== 'hex') {
      throw new ToolError(
        'VALIDATION',
        `Invalid formats entry: "${f}". Expected one of: raw, base64, hex`,
      );
    }
  }

  const includeContext = opts.includeContext ?? true;
  const contextBytes = (() => {
    if (opts.contextBytes === undefined) return BINARY_SECRETS_CONTEXT_BYTES;
    if (
      typeof opts.contextBytes !== 'number' ||
      !Number.isInteger(opts.contextBytes) ||
      opts.contextBytes < 0 ||
      opts.contextBytes > 1024
    ) {
      throw new ToolError(
        'VALIDATION',
        `contextBytes must be an integer in [0, 1024] (got ${String(opts.contextBytes)})`,
      );
    }
    return opts.contextBytes;
  })();

  const maxResults = (() => {
    if (opts.maxResults === undefined) return BINARY_SECRETS_MAX_RESULTS;
    if (
      typeof opts.maxResults !== 'number' ||
      !Number.isInteger(opts.maxResults) ||
      opts.maxResults <= 0
    ) {
      throw new ToolError(
        'VALIDATION',
        `maxResults must be a positive integer (got ${String(opts.maxResults)})`,
      );
    }
    return opts.maxResults;
  })();

  const maxChunkBytes = Math.max(opts.maxChunkBytes ?? DEFAULT_CHUNK, 8192);
  const overlapBytes = Math.min(BINARY_SECRETS_CHUNK_OVERLAP_BYTES, maxChunkBytes - 1);

  const scanWindowStart = opts.scanWindow?.start ?? 0;
  const scanWindowEnd = opts.scanWindow?.end ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isFinite(scanWindowStart) ||
    !Number.isFinite(scanWindowEnd) ||
    scanWindowStart < 0 ||
    scanWindowEnd <= scanWindowStart
  ) {
    throw new ToolError(
      'VALIDATION',
      `scanWindow must satisfy 0 <= start < end (got start=${scanWindowStart}, end=${scanWindowEnd})`,
    );
  }

  return {
    keyLengths,
    maxRawWindow: Math.max(...keyLengths),
    minRawWindow: Math.min(...keyLengths),
    minEntropy,
    formats,
    includeContext,
    contextBytes,
    maxResults,
    maxChunkBytes,
    overlapBytes,
    scanWindowStart,
    scanWindowEnd,
  };
}

/* ── Scanning ─────────────────────────────────────────────────────── */

function scanChunk(
  combined: Buffer,
  baseOffset: number,
  cfg: NormalizedConfig,
  emit: (hit: RawHit) => void,
): void {
  if (cfg.formats.has('raw')) {
    for (const w of cfg.keyLengths) {
      if (w > combined.length) continue;
      for (const [offset, entropy] of slidingEntropy(combined, w)) {
        if (entropy < cfg.minEntropy) continue;
        const slice = combined.subarray(offset, offset + w);
        emit({
          absOffset: baseOffset + offset,
          length: w,
          format: 'raw',
          bytes: Uint8Array.from(slice),
        });
      }
    }
  }

  if (cfg.formats.has('base64')) {
    for (const hit of scanBase64Runs(combined, baseOffset, cfg)) emit(hit);
  }
  if (cfg.formats.has('hex')) {
    for (const hit of scanHexRuns(combined, baseOffset, cfg)) emit(hit);
  }
}

function isBase64Char(b: number): boolean {
  // A-Z 0x41-0x5a, a-z 0x61-0x7a, 0-9 0x30-0x39, '+' 0x2b, '/' 0x2f
  return (
    (b >= 0x41 && b <= 0x5a) ||
    (b >= 0x61 && b <= 0x7a) ||
    (b >= 0x30 && b <= 0x39) ||
    b === 0x2b ||
    b === 0x2f
  );
}

function isHexChar(b: number): boolean {
  return (
    (b >= 0x30 && b <= 0x39) || // 0-9
    (b >= 0x41 && b <= 0x46) || // A-F
    (b >= 0x61 && b <= 0x66) // a-f
  );
}

function* scanBase64Runs(
  buf: Buffer,
  baseOffset: number,
  cfg: NormalizedConfig,
): Generator<RawHit> {
  const minLen = BINARY_SECRETS_MIN_BASE64_LENGTH;
  const maxLen = BINARY_SECRETS_MAX_BASE64_LENGTH;
  const allowedLengths = new Set(cfg.keyLengths);
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const b = i < buf.length ? (buf[i] as number) : -1;
    const inRun = b !== -1 && isBase64Char(b);
    if (inRun) {
      if (start === -1) start = i;
      continue;
    }
    if (start === -1) continue;
    const runStart = start;
    start = -1;
    // Run terminated at i. Consume optional '=' padding (at most 2).
    let end = i;
    let padding = 0;
    while (padding < 2 && end < buf.length && (buf[end] as number) === 0x3d) {
      end++;
      padding++;
    }
    const runLen = end - runStart;
    if (runLen < minLen || runLen > maxLen) continue;
    // Diversity gate: reject all-same-character or trivial runs (less than 5
    // distinct chars across an ≥24-char run is almost always noise).
    const distinctChars = countDistinct(buf, runStart, runLen);
    if (distinctChars < 5) continue;
    const slice = buf.subarray(runStart, end);
    let decoded: Buffer;
    try {
      decoded = Buffer.from(slice.toString('ascii'), 'base64');
    } catch {
      continue;
    }
    if (decoded.length === 0) continue;
    if (!allowedLengths.has(decoded.length)) continue;
    yield {
      absOffset: baseOffset + runStart,
      length: decoded.length,
      format: 'base64',
      bytes: Uint8Array.from(decoded),
    };
  }
}

function* scanHexRuns(buf: Buffer, baseOffset: number, cfg: NormalizedConfig): Generator<RawHit> {
  const minLen = BINARY_SECRETS_MIN_HEX_LENGTH;
  const maxLen = BINARY_SECRETS_MAX_HEX_LENGTH;
  const allowedLengths = new Set(cfg.keyLengths);
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const b = i < buf.length ? (buf[i] as number) : -1;
    const inRun = b !== -1 && isHexChar(b);
    if (inRun) {
      if (start === -1) start = i;
      continue;
    }
    if (start === -1) continue;
    let runLen = i - start;
    // Trim to even length so the decoded byte count is well-defined.
    if (runLen % 2 === 1) runLen -= 1;
    const runStart = start;
    start = -1;
    if (runLen < minLen || runLen > maxLen) continue;
    const decodedLen = runLen / 2;
    if (!allowedLengths.has(decodedLen)) continue;
    const slice = buf.subarray(runStart, runStart + runLen);
    const decoded = Buffer.from(slice.toString('ascii'), 'hex');
    if (decoded.length !== decodedLen) continue;
    yield {
      absOffset: baseOffset + runStart,
      length: decodedLen,
      format: 'hex',
      bytes: Uint8Array.from(decoded),
    };
  }
}

function countDistinct(buf: Buffer, start: number, length: number): number {
  const seen = new Uint8Array(256);
  let count = 0;
  for (let i = start; i < start + length; i++) {
    const b = buf[i] as number;
    if (seen[b] === 0) {
      seen[b] = 1;
      count++;
    }
  }
  return count;
}

/* ── Context materialization ──────────────────────────────────────── */

async function materializeCandidates(
  filePath: string,
  scored: ReadonlyArray<{ hit: RawHit; entropy: number }>,
  cfg: NormalizedConfig,
  totalSize: number,
): Promise<readonly KeyCandidate[]> {
  const out: KeyCandidate[] = [];
  for (const { hit, entropy } of scored) {
    const previewLen = Math.min(hit.length, BINARY_SECRETS_VALUE_PREVIEW_BYTES);
    const preview = Buffer.from(hit.bytes.subarray(0, previewLen)).toString('hex');
    const candidate: KeyCandidate = {
      offset: hit.absOffset,
      length: hit.length,
      format: hit.format,
      entropy,
      value: preview,
      ...(hit.length > previewLen ? { valueTruncated: true } : {}),
      ...(cfg.includeContext
        ? { context: await readContextWindow(filePath, hit, cfg.contextBytes, totalSize) }
        : {}),
    };
    out.push(candidate);
  }
  return out;
}

async function readContextWindow(
  filePath: string,
  hit: RawHit,
  contextBytes: number,
  totalSize: number,
): Promise<KeyCandidateContext> {
  if (contextBytes === 0) {
    return { before: '', after: '', beforeAscii: '', afterAscii: '' };
  }
  // For 'raw' the candidate occupies `length` bytes starting at `absOffset`.
  // For 'base64'/'hex' the **encoded** string occupies more bytes than
  // `length` (the decoded payload). We approximate context by reading
  // contextBytes immediately before/after `absOffset` and `absOffset+length`
  // respectively — close enough for forensic review without re-parsing
  // the encoded run.
  const beforeStart = Math.max(0, hit.absOffset - contextBytes);
  const beforeEnd = hit.absOffset;
  const afterStart = Math.min(totalSize, hit.absOffset + hit.length);
  const afterEnd = Math.min(totalSize, afterStart + contextBytes);

  const before = await readRange(filePath, beforeStart, beforeEnd);
  const after = await readRange(filePath, afterStart, afterEnd);
  return {
    before: before.toString('hex'),
    after: after.toString('hex'),
    beforeAscii: toAsciiPrintable(before),
    afterAscii: toAsciiPrintable(after),
  };
}

async function readRange(filePath: string, start: number, end: number): Promise<Buffer> {
  if (end <= start) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  const stream = createReadStream(filePath, { start, end: end - 1 });
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function toAsciiPrintable(buf: Buffer): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] as number;
    s += b >= MIN_PRINTABLE && b <= MAX_PRINTABLE ? String.fromCharCode(b) : '.';
  }
  return s;
}
