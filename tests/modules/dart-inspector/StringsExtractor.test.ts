import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { StringsExtractor } from '@modules/dart-inspector/StringsExtractor';
import type { CategoryRule, ExtractedString } from '@modules/dart-inspector/types';
import { TEST_URLS, buildTestUrl, withPath } from '@tests/shared/test-urls';

const API_URL = withPath(TEST_URLS.api, '/login');
const ONLY_ONCE_URL = buildTestUrl('only-once');
const NORMAL_URL = withPath(buildTestUrl('normal'), '/api');
const UTF16_URL = buildTestUrl('utf16');

let tmpDir: string;
let basicFixturePath: string;
let duplicatesFixturePath: string;
let crossChunkFixturePath: string;
let utf16OnlyFixturePath: string;

/** Pad buffer at `offset` with the given string (ASCII, 1-byte). Returns end offset. */
function writeAscii(buf: Buffer, offset: number, value: string): number {
  buf.write(value, offset, 'ascii');
  // null-terminator helps the ASCII scanner treat it as a complete string
  buf.writeUInt8(0, offset + value.length);
  return offset + value.length + 1;
}

/** Write UTF-16LE encoded string at offset; terminate with two zero bytes. */
function writeUtf16le(buf: Buffer, offset: number, value: string): number {
  buf.write(value, offset, 'utf16le');
  const end = offset + value.length * 2;
  buf.writeUInt16LE(0, end);
  return end + 2;
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dart-inspector-test-'));

  // ── Basic fixture: one of each default category + raw noise ──
  const basic = Buffer.alloc(4096, 0xff); // 0xff is non-printable, won't match strings
  let p = 200;
  p = writeAscii(basic, p, API_URL);
  p = writeAscii(basic, p + 50, '/api/v1/users');
  p = writeAscii(basic, p + 50, 'LoginViewModel');
  p = writeAscii(basic, p + 50, 'package:dio/src/dio.dart');
  // Two crypto keywords: 'AES' (3 chars, filtered by default minLength=4),
  // 'HMAC' (4 chars, survives default minLength).
  p = writeAscii(basic, p + 50, 'AES');
  p = writeAscii(basic, p + 50, 'HMAC');
  p = writeAscii(basic, p + 50, 'some_unclassified_value_xyz');
  basicFixturePath = join(tmpDir, 'basic.bin');
  await writeFile(basicFixturePath, basic);

  // ── Duplicates fixture: same string appears 3 times ──
  const dup = Buffer.alloc(2048, 0xff);
  writeAscii(dup, 100, 'TWICE_OCCURRING_TOKEN');
  writeAscii(dup, 500, 'TWICE_OCCURRING_TOKEN');
  writeAscii(dup, 1000, 'TWICE_OCCURRING_TOKEN');
  writeAscii(dup, 1500, ONLY_ONCE_URL);
  duplicatesFixturePath = join(tmpDir, 'dup.bin');
  await writeFile(duplicatesFixturePath, dup);

  // ── Cross-chunk fixture: string straddles offset 1024 (we'll force maxChunkBytes=1024) ──
  // String 'CROSS_CHUNK_BOUNDARY_DETECTED_STRING' (36 chars) at offset 1010 ⇒ ends at 1046
  const cross = Buffer.alloc(4096, 0xff);
  writeAscii(cross, 1010, 'CROSS_CHUNK_BOUNDARY_DETECTED_STRING');
  // also add a same-chunk normal string at offset 100
  writeAscii(cross, 100, NORMAL_URL);
  crossChunkFixturePath = join(tmpDir, 'cross.bin');
  await writeFile(crossChunkFixturePath, cross);

  // ── UTF-16LE-only fixture ──
  const u16 = Buffer.alloc(2048, 0xff);
  writeUtf16le(u16, 100, 'utf16_string_value');
  writeUtf16le(u16, 500, UTF16_URL);
  utf16OnlyFixturePath = join(tmpDir, 'u16.bin');
  await writeFile(utf16OnlyFixturePath, u16);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('StringsExtractor.extractFromFile - basic categorization', () => {
  it('returns the 5 default categories with appropriate hits', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath);

    expect(result.urls?.map((s) => s.value)).toEqual([API_URL]);
    expect(result.paths?.map((s) => s.value)).toEqual(['/api/v1/users']);
    expect(result.classNames?.map((s) => s.value)).toEqual(['LoginViewModel']);
    expect(result.packageRefs?.map((s) => s.value)).toEqual(['package:dio/src/dio.dart']);
    // 'AES' (3 chars) is filtered by default minLength=4; 'HMAC' survives.
    expect(result.cryptoKeywords?.map((s) => s.value)).toEqual(['HMAC']);
  });

  it("'raw' is absent by default", async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath);
    expect(result.raw).toBeUndefined();
  });

  it('includeRaw=true returns unmatched strings in raw', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath, { includeRaw: true });
    const rawValues = result.raw?.map((s) => s.value) ?? [];
    expect(rawValues).toContain('some_unclassified_value_xyz');
  });
});

describe('StringsExtractor.extractFromFile - offsets', () => {
  it('records the correct byte offset for each hit (ASCII)', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath);
    const urlHit = result.urls?.[0];
    expect(urlHit).toBeDefined();
    expect(urlHit?.offsets).toEqual([200]);
    expect(urlHit?.encoding).toBe('ascii');
  });

  it('merges multiple occurrences into a single ExtractedString with all offsets', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(duplicatesFixturePath, { includeRaw: true });

    const dupHit = result.raw?.find((s) => s.value === 'TWICE_OCCURRING_TOKEN');
    expect(dupHit).toBeDefined();
    expect(dupHit?.offsets).toEqual([100, 500, 1000]);
  });

  it('offsets are sorted ascending and deduplicated', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(duplicatesFixturePath, { includeRaw: true });

    const dupHit = result.raw?.find((s) => s.value === 'TWICE_OCCURRING_TOKEN');
    const offsets = dupHit?.offsets ?? [];
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1] as number);
    }
  });

  it('maxOffsetsPerString truncates and marks truncated=true', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(duplicatesFixturePath, {
      includeRaw: true,
      maxOffsetsPerString: 2,
    });

    const dupHit = result.raw?.find((s) => s.value === 'TWICE_OCCURRING_TOKEN');
    expect(dupHit?.offsets).toHaveLength(2);
    expect(dupHit?.truncated).toBe(true);
  });

  it('non-truncated entries do not carry truncated field', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(duplicatesFixturePath);
    const url = result.urls?.[0];
    expect(url?.truncated).toBeUndefined();
  });

  it('includeOffsets=false strips the offsets field', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath, { includeOffsets: false });
    const url = result.urls?.[0];
    expect(url).toBeDefined();
    expect(url?.offsets).toBeUndefined();
    expect(url?.value).toBe(API_URL);
  });
});

describe('StringsExtractor.extractFromFile - encoding selection', () => {
  it("encoding='ascii' ignores UTF-16LE strings", async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(utf16OnlyFixturePath, {
      encoding: 'ascii',
      includeRaw: true,
    });
    const all = [...(result.urls ?? []), ...(result.raw ?? [])];
    const utf16Hit = all.find((s) => s.value === 'utf16_string_value');
    expect(utf16Hit).toBeUndefined();
  });

  it("encoding='utf16le' picks up UTF-16LE strings", async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(utf16OnlyFixturePath, {
      encoding: 'utf16le',
      includeRaw: true,
    });
    const all = [...(result.urls ?? []), ...(result.raw ?? [])];
    const utf16Hit = all.find((s) => s.value === 'utf16_string_value');
    expect(utf16Hit).toBeDefined();
    expect(utf16Hit?.encoding).toBe('utf16le');
  });

  it("encoding='utf16le' ignores ASCII-only strings", async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath, {
      encoding: 'utf16le',
      includeRaw: true,
    });
    const all = [
      ...(result.urls ?? []),
      ...(result.paths ?? []),
      ...(result.classNames ?? []),
      ...(result.packageRefs ?? []),
      ...(result.cryptoKeywords ?? []),
      ...(result.raw ?? []),
    ];
    // ASCII fixture has no UTF-16LE strings, so nothing should be found
    expect(all).toHaveLength(0);
  });

  it("encoding='both' (default) scans both encodings", async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(utf16OnlyFixturePath, { includeRaw: true });
    const allValues = [...(result.urls ?? []), ...(result.raw ?? [])].map((s) => s.value);
    expect(allValues).toContain('utf16_string_value');
  });
});

describe('StringsExtractor.extractFromFile - minLength', () => {
  it('filters strings shorter than minLength', async () => {
    const extractor = new StringsExtractor();
    // basic fixture has 'HMAC' (4 chars); minLength=10 should filter it out
    const result = await extractor.extractFromFile(basicFixturePath, { minLength: 10 });
    expect(result.cryptoKeywords).toEqual([]);
    // longer strings still present
    expect(result.urls?.length).toBe(1);
  });

  it('defaults to DART_MIN_LENGTH (4) — picks up 4-char strings', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath);
    // 'AES' (3 chars) filtered, 'HMAC' (4 chars) kept
    expect(result.cryptoKeywords?.map((s) => s.value)).toEqual(['HMAC']);
  });
});

describe('StringsExtractor.extractFromFile - cross-chunk', () => {
  it('detects strings that straddle a chunk boundary', async () => {
    const extractor = new StringsExtractor();
    // Force a small chunk to make the boundary fall mid-string
    const result = await extractor.extractFromFile(crossChunkFixturePath, {
      maxChunkBytes: 1024,
      includeRaw: true,
    });
    const all = [...(result.urls ?? []), ...(result.raw ?? [])];
    const crossHit = all.find((s) => s.value === 'CROSS_CHUNK_BOUNDARY_DETECTED_STRING');
    expect(crossHit).toBeDefined();
    expect(crossHit?.offsets).toEqual([1010]);
  });
});

describe('StringsExtractor.extractFromFile - customRules', () => {
  const flagRule: CategoryRule = {
    category: 'apiHost',
    pattern: /^https:\/\/api\./,
  };

  it("ruleMode='append' (default) keeps defaults active alongside custom rule", async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath, {
      customRules: [flagRule],
      ruleMode: 'append',
    });
    // url still classified by default rule first
    expect(result.urls?.length).toBe(1);
    // apiHost bucket exists but is empty (default rule matched first)
    expect(result.apiHost).toEqual([]);
  });

  it("ruleMode='prepend' lets custom rule take precedence", async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath, {
      customRules: [flagRule],
      ruleMode: 'prepend',
    });
    expect(result.apiHost?.map((s) => s.value)).toEqual([API_URL]);
    // urls bucket exists but does not contain the now-routed url
    expect(result.urls?.find((s) => s.value === API_URL)).toBeUndefined();
  });

  it("ruleMode='replace' uses only custom rules (defaults disabled)", async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath, {
      customRules: [flagRule],
      ruleMode: 'replace',
      includeRaw: true,
    });
    expect(result.apiHost?.length).toBe(1);
    // default categories should not appear as keys (replace mode)
    expect(result.urls).toBeUndefined();
    expect(result.paths).toBeUndefined();
    // Strings that the custom rule didn't match should land in raw
    const rawValues = result.raw?.map((s) => s.value) ?? [];
    expect(rawValues).toContain('LoginViewModel');
  });
});

describe('StringsExtractor.extractFromFile - error handling', () => {
  it('throws ToolError NOT_FOUND for a missing file', async () => {
    const extractor = new StringsExtractor();
    await expect(
      extractor.extractFromFile(join(tmpDir, 'does-not-exist.bin')),
    ).rejects.toThrowError(expect.objectContaining({ name: 'ToolError', code: 'NOT_FOUND' }));
  });

  it('throws ToolError VALIDATION for empty filePath', async () => {
    const extractor = new StringsExtractor();
    await expect(extractor.extractFromFile('')).rejects.toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });
});

describe('StringsExtractor.extractFromFile - result shape consistency', () => {
  it('every ExtractedString has value + encoding (offsets unless explicitly off)', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicFixturePath);
    const all: ExtractedString[] = [
      ...(result.urls ?? []),
      ...(result.paths ?? []),
      ...(result.classNames ?? []),
      ...(result.packageRefs ?? []),
      ...(result.cryptoKeywords ?? []),
    ];
    for (const s of all) {
      expect(typeof s.value).toBe('string');
      expect(['ascii', 'utf16le']).toContain(s.encoding);
      expect(Array.isArray(s.offsets)).toBe(true);
      expect(s.offsets.length).toBeGreaterThan(0);
    }
  });
});
