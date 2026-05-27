#!/usr/bin/env tsx
/**
 * Build the tiny libapp.so fixture used by dart-inspector tests.
 *
 * Outputs:
 *   tests/fixtures/dart-inspector/tiny-libapp.so      (4 KB synthetic binary)
 *   tests/fixtures/dart-inspector/expected-strings.json
 *
 * Regenerate with:
 *   pnpm tsx tests/fixtures/dart-inspector/build-tiny-libapp.ts
 *
 * Design constraints (see openspec/changes/add-dart-strings-extract/tasks.md §1.3.1):
 *   - 4 KB total (covers > 1 KB so we can force a cross-chunk straddle)
 *   - All 5 default categories populated with ≥ 2 strings each
 *   - One string appears ≥ 3 times to exercise offset merging
 *   - One string crosses the 1024-byte boundary (cross-chunk detection)
 *   - One UTF-16LE entry so the `expected-strings.json` covers both encodings
 *
 * The buffer is initialised with `0xFF` (non-printable) so unused regions stay
 * invisible to the scanner.
 */

import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const BIN_PATH = join(FIXTURE_DIR, 'tiny-libapp.so');
const JSON_PATH = join(FIXTURE_DIR, 'expected-strings.json');

const FIXTURE_SIZE = 4096;
const FILL_BYTE = 0xff;

interface PlannedString {
  value: string;
  offset: number;
  encoding: 'ascii' | 'utf16le';
  /** Default rule that should classify this string (or 'raw' if intentionally unclassified). */
  expectedCategory: 'urls' | 'paths' | 'classNames' | 'packageRefs' | 'cryptoKeywords' | 'raw';
}

// Layout — every entry pinned by hand so expected offsets are deterministic.
// Keep gaps ≥ 8 bytes between strings so the null terminator and 0xFF padding
// never abut the next entry.
const PLAN: readonly PlannedString[] = [
  // urls (2)
  {
    value: withPath(TEST_URLS.api, '/login'),
    offset: 100,
    encoding: 'ascii',
    expectedCategory: 'urls',
  },
  {
    value: withPath(TEST_URLS.cdn, '/static/asset'),
    offset: 200,
    encoding: 'ascii',
    expectedCategory: 'urls',
  },

  // paths (2). Avoid image extensions so the exclude rule doesn't kick in.
  { value: '/api/v1/users', offset: 280, encoding: 'ascii', expectedCategory: 'paths' },
  { value: '/data/storage/cache', offset: 330, encoding: 'ascii', expectedCategory: 'paths' },

  // classNames (2). Must start with uppercase, contain ≥ 3 alphanumerics, not all caps.
  { value: 'LoginViewModel', offset: 400, encoding: 'ascii', expectedCategory: 'classNames' },
  { value: 'UserRepository', offset: 450, encoding: 'ascii', expectedCategory: 'classNames' },

  // packageRefs (2)
  {
    value: 'package:dio/src/dio.dart',
    offset: 500,
    encoding: 'ascii',
    expectedCategory: 'packageRefs',
  },
  {
    value: 'package:provider/provider.dart',
    offset: 560,
    encoding: 'ascii',
    expectedCategory: 'packageRefs',
  },

  // cryptoKeywords (2). `AES`/`RSA`/`MD5`/`key` are 3 chars and would be filtered by the
  // default minLength of 4. Pick `HMAC` and `SHA256` so the fixture survives default tuning.
  { value: 'HMAC', offset: 620, encoding: 'ascii', expectedCategory: 'cryptoKeywords' },
  { value: 'SHA256', offset: 640, encoding: 'ascii', expectedCategory: 'cryptoKeywords' },

  // Triple-occurrence raw token — exercises offset merging.
  { value: 'TRIPLE_TOKEN_VALUE_AA', offset: 700, encoding: 'ascii', expectedCategory: 'raw' },
  { value: 'TRIPLE_TOKEN_VALUE_AA', offset: 800, encoding: 'ascii', expectedCategory: 'raw' },
  { value: 'TRIPLE_TOKEN_VALUE_AA', offset: 900, encoding: 'ascii', expectedCategory: 'raw' },

  // Cross-chunk straddle — string starts at 1010 and continues past 1024.
  // 36 chars → ends at 1046, comfortably across a 1024-byte chunk boundary.
  {
    value: 'CROSS_CHUNK_BOUNDARY_DETECTED_STRING',
    offset: 1010,
    encoding: 'ascii',
    expectedCategory: 'raw',
  },

  // UTF-16LE entry so both encodings are represented.
  { value: 'utf16_user_pref_key', offset: 1100, encoding: 'utf16le', expectedCategory: 'raw' },
];

function writeAscii(buf: Buffer, offset: number, value: string): void {
  buf.write(value, offset, 'ascii');
  // Explicit NUL terminator — easier to read in a hex dump than relying on 0xFF
  // fill bytes to break the printable run.
  buf.writeUInt8(0, offset + value.length);
}

function writeUtf16le(buf: Buffer, offset: number, value: string): void {
  buf.write(value, offset, 'utf16le');
  buf.writeUInt16LE(0, offset + value.length * 2);
}

function assertPlanFits(plan: readonly PlannedString[], size: number): void {
  for (const entry of plan) {
    const byteLength =
      entry.encoding === 'ascii' ? entry.value.length + 1 : entry.value.length * 2 + 2;
    const end = entry.offset + byteLength;
    if (end > size) {
      throw new Error(
        `PLAN entry "${entry.value}" at offset ${entry.offset} ends at ${end}, beyond fixture size ${size}`,
      );
    }
  }
}

function buildBuffer(plan: readonly PlannedString[]): Buffer {
  const buf = Buffer.alloc(FIXTURE_SIZE, FILL_BYTE);
  for (const entry of plan) {
    if (entry.encoding === 'ascii') writeAscii(buf, entry.offset, entry.value);
    else writeUtf16le(buf, entry.offset, entry.value);
  }
  return buf;
}

interface ExpectedString {
  value: string;
  offsets: number[];
  encoding: 'ascii' | 'utf16le';
}

interface ExpectedReport {
  fixtureSize: number;
  fillByte: number;
  categories: Record<string, ExpectedString[]>;
  /** Strings that should land in `raw` when `includeRaw: true`. */
  raw: ExpectedString[];
  /** Subset that lets the cross-chunk test pin its assertion. */
  crossChunk: { value: string; offset: number };
}

function buildExpected(plan: readonly PlannedString[]): ExpectedReport {
  // Merge multi-occurrence strings into single entries with sorted offsets.
  const byKey = new Map<string, ExpectedString>();
  for (const entry of plan) {
    const key = `${entry.encoding}\x00${entry.value}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.offsets.push(entry.offset);
      existing.offsets.sort((a, b) => a - b);
    } else {
      byKey.set(key, { value: entry.value, offsets: [entry.offset], encoding: entry.encoding });
    }
  }

  const categories: Record<string, ExpectedString[]> = {
    urls: [],
    paths: [],
    classNames: [],
    packageRefs: [],
    cryptoKeywords: [],
  };
  const raw: ExpectedString[] = [];

  for (const entry of plan) {
    const key = `${entry.encoding}\x00${entry.value}`;
    const merged = byKey.get(key);
    if (!merged) continue;
    const target = entry.expectedCategory === 'raw' ? raw : categories[entry.expectedCategory];
    if (!target) continue;
    if (!target.some((s) => s.value === merged.value && s.encoding === merged.encoding)) {
      target.push(merged);
    }
  }

  for (const bucket of [...Object.values(categories), raw]) {
    bucket.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  }

  const crossChunkEntry = plan.find((e) => e.value === 'CROSS_CHUNK_BOUNDARY_DETECTED_STRING');
  if (!crossChunkEntry) throw new Error('PLAN missing cross-chunk anchor string');

  return {
    fixtureSize: FIXTURE_SIZE,
    fillByte: FILL_BYTE,
    categories,
    raw,
    crossChunk: { value: crossChunkEntry.value, offset: crossChunkEntry.offset },
  };
}

async function main(): Promise<void> {
  assertPlanFits(PLAN, FIXTURE_SIZE);
  const bin = buildBuffer(PLAN);
  const expected = buildExpected(PLAN);

  await writeFile(BIN_PATH, bin);
  await writeFile(JSON_PATH, `${JSON.stringify(expected, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(`wrote ${BIN_PATH} (${bin.length} bytes)`);
  // eslint-disable-next-line no-console
  console.log(`wrote ${JSON_PATH}`);
}

await main();
