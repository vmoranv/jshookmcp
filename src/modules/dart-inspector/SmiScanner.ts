/**
 * SmiScanner — recover Dart Small Integer (Smi) constants embedded inside a
 * libapp.so binary.
 *
 * Why this exists: the Dart VM tags every word-sized value with the low bit
 * — `0` for a Smi (small integer) and `1` for a heap pointer. Smi values
 * are therefore stored as `value << 1`, which means raw byte/string scans
 * miss them entirely. To recover an integer literal from compiled Dart
 * code you have to read aligned little-endian words and divide by 2.
 *
 * This scanner is intentionally narrow: it produces a list of plausible
 * Smi hits with their byte offset and decoded value. It does NOT try to
 * decide whether a given word is *actually* a Smi (vs. a coincidentally
 * even integer in some other data structure). Callers filter by value
 * range to keep the output manageable.
 *
 * 100% read-only analysis. No payloads, no exploit code.
 *
 * @see https://github.com/dart-lang/sdk — Dart VM Smi tagging convention
 * @see https://eldstal.se/blog/flutter-re.html — context on Smi-encoded
 *      immediates in AOT libapp.so disassembly
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

import { DART_MAX_CHUNK_BYTES, DART_MAX_OFFSETS_PER_STRING } from '@src/constants';
import { ToolError } from '@errors/ToolError';

import type { ScanWindow } from './types';

export type SmiWidth = 4 | 8;

export interface SmiScanOptions {
  /** Word width in bytes. 4 for 32-bit Smi (ARM32), 8 for 64-bit (ARM64). Default 8. */
  width?: SmiWidth;
  /** Restrict scanning to a byte range. */
  scanWindow?: ScanWindow;
  /** Stride between consecutive scan positions; defaults to `width`. */
  stride?: number;
  /** Minimum decoded value (inclusive). Default 1 (skip zero noise). */
  minValue?: number;
  /** Maximum decoded value (inclusive). Default 1_000_000. */
  maxValue?: number;
  /** Whether to include zero hits. Default false. */
  includeZero?: boolean;
  /** Whether to include negative hits. Default false. */
  includeNegative?: boolean;
  /** Cap on returned hits. Default DART_MAX_OFFSETS_PER_STRING. */
  maxResults?: number;
  /** Override the streaming chunk size. */
  maxChunkBytes?: number;
}

export interface SmiHit {
  offset: number;
  /** The raw word value as read from disk (already a non-negative integer). */
  rawValue: number;
  /** The Smi-decoded value (`(rawValue >> 1)` for positive, sign-extended for negative). */
  smiValue: number;
  width: SmiWidth;
}

export interface SmiScanResult {
  hits: SmiHit[];
  /** Number of word positions actually examined (after window/stride). */
  scanned: number;
  /** True if `maxResults` was hit and the scan stopped early. */
  truncated: boolean;
  width: SmiWidth;
}

const DEFAULT_MIN_VALUE = 1;
const DEFAULT_MAX_VALUE = 1_000_000;
const DEFAULT_WIDTH: SmiWidth = 8;

/**
 * Decode a 4-byte word as a signed Smi. Returns `undefined` if the low bit
 * is set (heap pointer tag, not a Smi).
 */
function decodeSmi32(buf: Buffer, offset: number): number | undefined {
  const raw = buf.readUInt32LE(offset);
  if ((raw & 1) !== 0) return undefined;
  // Sign-extend the 32-bit signed integer interpretation of (raw >> 1).
  // raw is unsigned 32-bit; >> 1 yields 31-bit unsigned; we want signed via Int32 view.
  const signed = raw | 0; // reinterpret as signed 32-bit
  return signed >> 1; // arithmetic shift preserves sign
}

/**
 * Decode an 8-byte word as a signed Smi. Uses BigInt internally to handle
 * the full 64-bit range, then narrows to Number — which loses precision
 * above 2^53 but those values are far outside any plausible Smi anyway.
 */
function decodeSmi64(buf: Buffer, offset: number): number | undefined {
  const raw = buf.readBigUInt64LE(offset);
  if ((raw & 1n) !== 0n) return undefined;
  // Signed shift right by 1.
  const signed = BigInt.asIntN(64, raw);
  const decoded = signed >> 1n;
  // Constrain to safe Number range. Out-of-range values are dropped — they
  // can't be meaningful Smi literals.
  if (decoded > BigInt(Number.MAX_SAFE_INTEGER) || decoded < BigInt(Number.MIN_SAFE_INTEGER)) {
    return undefined;
  }
  return Number(decoded);
}

export class SmiScanner {
  async scanFile(filePath: string, opts: SmiScanOptions = {}): Promise<SmiScanResult> {
    if (!filePath || filePath.length === 0) {
      throw new ToolError('VALIDATION', 'filePath must be a non-empty string');
    }
    try {
      await stat(filePath);
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `File not found: ${filePath}`, {
        details: { filePath },
        cause: cause as Error,
      });
    }

    const width: SmiWidth = opts.width ?? DEFAULT_WIDTH;
    if (width !== 4 && width !== 8) {
      throw new ToolError('VALIDATION', `SmiScanner width must be 4 or 8 (got ${width})`);
    }
    const stride = opts.stride ?? width;
    if (!Number.isInteger(stride) || stride < 1) {
      throw new ToolError(
        'VALIDATION',
        `SmiScanner stride must be a positive integer (got ${stride})`,
      );
    }
    const windowStart = opts.scanWindow?.start ?? 0;
    const windowEnd = opts.scanWindow?.end ?? Number.POSITIVE_INFINITY;
    if (windowStart < 0 || windowEnd <= windowStart) {
      throw new ToolError(
        'VALIDATION',
        `SmiScanner scanWindow must satisfy 0 <= start < end (got start=${windowStart}, end=${opts.scanWindow?.end ?? 'Infinity'})`,
      );
    }
    const minValue = opts.minValue ?? DEFAULT_MIN_VALUE;
    const maxValue = opts.maxValue ?? DEFAULT_MAX_VALUE;
    if (minValue > maxValue) {
      throw new ToolError(
        'VALIDATION',
        `SmiScanner minValue (${minValue}) must be <= maxValue (${maxValue})`,
      );
    }
    const includeZero = opts.includeZero ?? false;
    const includeNegative = opts.includeNegative ?? false;
    const maxResults = opts.maxResults ?? DART_MAX_OFFSETS_PER_STRING;
    const maxChunkBytes = Math.max(opts.maxChunkBytes ?? DART_MAX_CHUNK_BYTES, width * 16);

    const decode = width === 4 ? decodeSmi32 : decodeSmi64;

    const hits: SmiHit[] = [];
    let scanned = 0;
    let truncated = false;

    // Stream the file in chunks. Carry-over (width - 1) bytes so a word that
    // straddles a chunk boundary is still read correctly on the next pass.
    const stream = createReadStream(filePath, { highWaterMark: maxChunkBytes });
    let pending: Buffer = Buffer.alloc(0);
    let nextAbsolute = 0;

    for await (const chunk of stream) {
      if (truncated) break;
      const chunkBuf = chunk as Buffer;
      const baseOffset = nextAbsolute - pending.length;
      const combined = pending.length === 0 ? chunkBuf : Buffer.concat([pending, chunkBuf]);
      // Scan every aligned word position inside `combined`.
      // The last (width - 1) bytes of `combined` are preserved as the next
      // iteration's pending buffer.
      const scanEnd = combined.length - (width - 1);
      // Compute the first absolute offset within this chunk that lies on the
      // stride grid relative to file start AND inside the window.
      let absOffset = Math.max(baseOffset, windowStart);
      // Align absOffset up to the next multiple of stride.
      const misalignment = absOffset % stride;
      if (misalignment !== 0) absOffset += stride - misalignment;

      while (absOffset < windowEnd) {
        const localOffset = absOffset - baseOffset;
        if (localOffset >= scanEnd) break;
        scanned++;
        const decoded = decode(combined, localOffset);
        if (decoded !== undefined) {
          const inRange =
            (decoded === 0 ? includeZero : true) &&
            (decoded < 0 ? includeNegative : true) &&
            decoded >= minValue &&
            decoded <= maxValue;
          if (inRange) {
            hits.push({
              offset: absOffset,
              rawValue:
                width === 4
                  ? combined.readUInt32LE(localOffset)
                  : Number(combined.readBigUInt64LE(localOffset)),
              smiValue: decoded,
              width,
            });
            if (hits.length >= maxResults) {
              truncated = true;
              break;
            }
          }
        }
        absOffset += stride;
      }

      nextAbsolute += chunkBuf.length;
      const carry = Math.min(combined.length, width - 1);
      pending = combined.subarray(combined.length - carry);
    }

    return { hits, scanned, truncated, width };
  }
}
