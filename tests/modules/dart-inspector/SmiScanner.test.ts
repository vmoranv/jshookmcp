/**
 * Tests for SmiScanner — Dart Small Integer recovery from libapp.so.
 *
 * Synthetic fixtures encode known values via `value << 1` little-endian,
 * then verify the scanner recovers them with correct offsets and decoded
 * values, honors range/zero/negative filters, and aborts cleanly on
 * malformed input.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { SmiScanner } from '@modules/dart-inspector/SmiScanner';

let tmpDir: string;
let fixture32: string;
let fixture64: string;
let mixed64: string;

/** Write a 32-bit Smi-encoded value at `offset` (`value << 1`, little-endian). */
function writeSmi32(buf: Buffer, offset: number, value: number): void {
  // Sign-correct encoding: keep low bit = 0, shift the rest.
  // For negatives this wraps via two's complement at 32-bit width — exactly
  // what the Dart VM does internally for ARM32 Smis.
  const encoded = (value << 1) >>> 0;
  buf.writeUInt32LE(encoded, offset);
}

/** Write a 64-bit Smi-encoded value at `offset`. */
function writeSmi64(buf: Buffer, offset: number, value: bigint): void {
  const encoded = BigInt.asUintN(64, value << 1n);
  buf.writeBigUInt64LE(encoded, offset);
}

/** Write a heap-tagged (low bit set) pointer-shaped word so the scanner skips it. */
function writePointer64(buf: Buffer, offset: number, ptr: bigint): void {
  buf.writeBigUInt64LE(BigInt.asUintN(64, ptr | 1n), offset);
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'smi-scanner-'));

  // 32-bit fixture: a few known Smi values at well-known offsets,
  // padded with 0xFF bytes (which appear as raw=0xFFFFFFFF — odd, so skipped).
  const buf32 = Buffer.alloc(256, 0xff);
  writeSmi32(buf32, 0x10, 42);
  writeSmi32(buf32, 0x20, 1337);
  writeSmi32(buf32, 0x30, 100000);
  writeSmi32(buf32, 0x40, -7);
  writeSmi32(buf32, 0x50, 0);
  fixture32 = join(tmpDir, 'smi32.bin');
  await writeFile(fixture32, buf32);

  // 64-bit fixture: positives, negatives, zero, plus an explicit pointer.
  const buf64 = Buffer.alloc(256, 0xff);
  writeSmi64(buf64, 0x10, 42n);
  writeSmi64(buf64, 0x18, 1337n);
  writeSmi64(buf64, 0x20, 100000n);
  writeSmi64(buf64, 0x28, -7n);
  writeSmi64(buf64, 0x30, 0n);
  writePointer64(buf64, 0x38, 0xdeadbeefn);
  fixture64 = join(tmpDir, 'smi64.bin');
  await writeFile(fixture64, buf64);

  // Mixed fixture — used to verify minValue/maxValue trimming.
  const mixed = Buffer.alloc(256, 0xff);
  writeSmi64(mixed, 0x10, 5n);
  writeSmi64(mixed, 0x18, 50n);
  writeSmi64(mixed, 0x20, 500n);
  writeSmi64(mixed, 0x28, 5000n);
  writeSmi64(mixed, 0x30, 50000n);
  mixed64 = join(tmpDir, 'mixed64.bin');
  await writeFile(mixed64, mixed);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('SmiScanner.scanFile — 32-bit width', () => {
  it('recovers positive Smi values with their offsets', async () => {
    const scanner = new SmiScanner();
    const result = await scanner.scanFile(fixture32, { width: 4, maxValue: 200000 });
    const decoded = result.hits.map((h) => ({ offset: h.offset, value: h.smiValue }));
    expect(decoded).toContainEqual({ offset: 0x10, value: 42 });
    expect(decoded).toContainEqual({ offset: 0x20, value: 1337 });
    expect(decoded).toContainEqual({ offset: 0x30, value: 100000 });
    // -7 excluded by default (includeNegative=false), 0 excluded (includeZero=false)
    expect(decoded.find((d) => d.value === -7)).toBeUndefined();
    expect(decoded.find((d) => d.value === 0)).toBeUndefined();
    expect(result.width).toBe(4);
  });

  it('includes negative Smi when includeNegative=true', async () => {
    const scanner = new SmiScanner();
    const result = await scanner.scanFile(fixture32, {
      width: 4,
      includeNegative: true,
      minValue: -100,
      maxValue: 200000,
    });
    const decoded = result.hits.map((h) => h.smiValue);
    expect(decoded).toContain(-7);
  });

  it('includes zero when includeZero=true', async () => {
    const scanner = new SmiScanner();
    const result = await scanner.scanFile(fixture32, {
      width: 4,
      includeZero: true,
      minValue: 0,
    });
    expect(result.hits.find((h) => h.smiValue === 0)).toBeDefined();
  });
});

describe('SmiScanner.scanFile — 64-bit width', () => {
  it('recovers 64-bit positive Smi values', async () => {
    const scanner = new SmiScanner();
    const result = await scanner.scanFile(fixture64, { width: 8, maxValue: 200000 });
    const decoded = result.hits.map((h) => ({ offset: h.offset, value: h.smiValue }));
    expect(decoded).toContainEqual({ offset: 0x10, value: 42 });
    expect(decoded).toContainEqual({ offset: 0x18, value: 1337 });
    expect(decoded).toContainEqual({ offset: 0x20, value: 100000 });
    expect(result.width).toBe(8);
  });

  it('skips pointer-tagged words (low bit set)', async () => {
    const scanner = new SmiScanner();
    const result = await scanner.scanFile(fixture64, {
      width: 8,
      // wide-open range so the pointer would otherwise sneak in
      minValue: 0,
      maxValue: Number.MAX_SAFE_INTEGER,
      includeZero: true,
      includeNegative: true,
    });
    expect(result.hits.find((h) => h.offset === 0x38)).toBeUndefined();
  });
});

describe('SmiScanner.scanFile — filtering', () => {
  it('honors minValue / maxValue', async () => {
    const scanner = new SmiScanner();
    const result = await scanner.scanFile(mixed64, {
      width: 8,
      minValue: 100,
      maxValue: 10000,
    });
    const decoded = result.hits.map((h) => h.smiValue).toSorted((a, b) => a - b);
    expect(decoded).toEqual([500, 5000]);
  });

  it('truncates at maxResults and reports truncated=true', async () => {
    const scanner = new SmiScanner();
    const result = await scanner.scanFile(mixed64, {
      width: 8,
      minValue: 1,
      maxValue: 1_000_000,
      maxResults: 2,
    });
    expect(result.hits.length).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('honors scanWindow', async () => {
    const scanner = new SmiScanner();
    const result = await scanner.scanFile(mixed64, {
      width: 8,
      // window covers offsets [0x20, 0x28) — just the 500 entry at 0x20.
      // 0x28 (5000) and beyond are excluded (end is exclusive).
      scanWindow: { start: 0x20, end: 0x28 },
      minValue: 1,
      maxValue: 1_000_000,
    });
    const decoded = result.hits.map((h) => h.smiValue);
    expect(decoded).toEqual([500]);
  });
});

describe('SmiScanner.scanFile — error handling', () => {
  it('throws NOT_FOUND for missing file', async () => {
    const scanner = new SmiScanner();
    await expect(scanner.scanFile(join(tmpDir, 'no-such-file'))).rejects.toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('throws VALIDATION for empty filePath', async () => {
    const scanner = new SmiScanner();
    await expect(scanner.scanFile('')).rejects.toThrowError(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });

  it('throws VALIDATION for invalid width', async () => {
    const scanner = new SmiScanner();
    await expect(scanner.scanFile(fixture32, { width: 16 as unknown as 4 })).rejects.toThrowError(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });

  it('throws VALIDATION for inverted scanWindow', async () => {
    const scanner = new SmiScanner();
    await expect(
      scanner.scanFile(fixture32, { scanWindow: { start: 0x80, end: 0x10 } }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
  });
});
