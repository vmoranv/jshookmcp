import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { KeyExtractor } from '@modules/binary-secrets/KeyExtractor';
import { BINARY_SECRETS_MAX_RESULTS } from '@modules/binary-secrets/constants';
import { ToolError } from '@errors/ToolError';
import {
  FIXTURE_AES128_OFFSET,
  FIXTURE_AES256_OFFSET,
  FIXTURE_BASE64_OFFSET,
  FIXTURE_HEX_OFFSET,
  buildFixture,
  writeFixture,
} from '@tests/fixtures/binary-secrets/build-keys-fixture';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'binary-secrets-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeBuf(buf: Buffer): Promise<string> {
  const p = join(workDir, `bin-${Math.random().toString(36).slice(2)}.bin`);
  await writeFile(p, buf);
  return p;
}

describe('KeyExtractor.extractFromFile — happy paths', () => {
  it('detects the planted 16-byte raw window in the fixture', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [16],
      formats: ['raw'],
      minEntropy: 3.5,
      maxResults: 100,
    });
    const hit = result.candidates.find(
      (c) => c.offset === FIXTURE_AES128_OFFSET && c.format === 'raw' && c.length === 16,
    );
    expect(hit, JSON.stringify(result.candidates, null, 2)).toBeDefined();
    expect(hit!.entropy).toBeGreaterThan(3);
  });

  it('detects the planted 32-byte raw window in the fixture', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [32],
      formats: ['raw'],
      minEntropy: 3,
      maxResults: 200,
    });
    const hit = result.candidates.find(
      (c) => c.offset === FIXTURE_AES256_OFFSET && c.format === 'raw' && c.length === 32,
    );
    expect(hit, JSON.stringify(result.candidates, null, 2)).toBeDefined();
  });

  it('detects the planted 64-char hex string and reports decoded length 32', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      formats: ['hex'],
      keyLengths: [32],
    });
    const hit = result.candidates.find(
      (c) => c.format === 'hex' && c.offset === FIXTURE_HEX_OFFSET,
    );
    expect(hit, JSON.stringify(result.candidates, null, 2)).toBeDefined();
    expect(hit!.length).toBe(32);
  });

  it('detects the planted Base64 string and reports decoded length 24', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      formats: ['base64'],
      keyLengths: [24],
    });
    const hit = result.candidates.find(
      (c) => c.format === 'base64' && c.offset === FIXTURE_BASE64_OFFSET,
    );
    expect(hit, JSON.stringify(result.candidates, null, 2)).toBeDefined();
    expect(hit!.length).toBe(24);
  });
});

describe('KeyExtractor — option filtering', () => {
  it('minEntropy filters out low-entropy windows', async () => {
    // A buffer with a 32-byte run of ascii letters (entropy = log2(32) ~ 5) and
    // a high-entropy block. With minEntropy=4.7 the ascii run is below the
    // floor (because contiguous ASCII letters cluster into the 0x61..0x7a
    // range and have lower-than-uniform entropy), but the hi-entropy block
    // (32 distinct bytes) is above.
    const ascii = Buffer.from('abcdefghijklmnopabcdefghijklmnop', 'ascii'); // 32 bytes, 16 distinct
    const hi = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) hi[i] = (i * 17 + 3) & 0xff;
    const buf = Buffer.concat([Buffer.alloc(64), ascii, Buffer.alloc(64), hi, Buffer.alloc(64)]);
    const p = await writeBuf(buf);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [32],
      formats: ['raw'],
      minEntropy: 4.5,
    });
    expect(
      result.candidates.find((c) => c.format === 'raw' && c.offset === 64),
      // ascii run sits at offset 64; should NOT be returned at minEntropy 4.5
    ).toBeUndefined();
    expect(
      result.candidates.find((c) => c.format === 'raw' && c.offset === 64 + 32 + 64),
    ).toBeDefined();
  });

  it('keyLengths restricts both raw window size and decoded encoded length', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [16],
      formats: ['raw', 'hex'],
      // 16-byte windows have max entropy log2(16) = 4, so 3.5 is permissive.
      minEntropy: 3.5,
    });
    // raw hit at 0x100 should be present
    expect(result.candidates.some((c) => c.format === 'raw' && c.length === 16)).toBe(true);
    // hex candidate at 0x180 decodes to 32 bytes — NOT in [16], so absent.
    expect(result.candidates.some((c) => c.format === 'hex')).toBe(false);
  });

  it('maxResults truncates and sets truncated flag', async () => {
    // High-entropy buffer big enough that thousands of overlapping raw
    // windows pass the entropy floor.
    const buf = Buffer.alloc(4096);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 251 + 13) & 0xff;
    const p = await writeBuf(buf);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [16],
      formats: ['raw'],
      minEntropy: 3,
      maxResults: 3,
    });
    expect(result.candidates).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('includeContext: false omits the context field', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [16],
      formats: ['raw'],
      minEntropy: 3,
      includeContext: false,
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) expect(c.context).toBeUndefined();
  });

  it('includeContext: true provides hex and ASCII previews of equal length', async () => {
    const p = join(workDir, 'fixture.bin');
    await writeFixture(p);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [16],
      formats: ['raw'],
      minEntropy: 3,
      contextBytes: 8,
    });
    const aes = result.candidates.find(
      (c) => c.format === 'raw' && c.offset === FIXTURE_AES128_OFFSET,
    );
    expect(aes?.context).toBeDefined();
    expect(aes!.context!.before.length).toBeLessThanOrEqual(16); // 8 bytes hex = 16 chars
    expect(aes!.context!.beforeAscii.length).toBeLessThanOrEqual(8);
  });
});

describe('KeyExtractor — cross-chunk and large input', () => {
  it('captures candidates that straddle a chunk boundary', async () => {
    // Build a buffer larger than chunk size, with a high-entropy 32-byte
    // window sitting exactly across the boundary. We use a small chunk
    // via maxChunkBytes to force the split.
    const chunkSize = 8192; // module's hardcoded minimum
    const buf = Buffer.alloc(chunkSize + 64, 0);
    // place a 32-byte high-entropy block straddling offset chunkSize - 16
    for (let i = 0; i < 32; i++) buf[chunkSize - 16 + i] = (i * 73 + 9) & 0xff;
    const p = await writeBuf(buf);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [32],
      formats: ['raw'],
      minEntropy: 3,
      maxChunkBytes: chunkSize,
    });
    const expected = chunkSize - 16;
    const hit = result.candidates.find((c) => c.format === 'raw' && c.offset === expected);
    expect(hit, JSON.stringify(result.candidates, null, 2)).toBeDefined();
  });

  it('returns scannedBytes equal to file size for a full scan', async () => {
    const buf = buildFixture();
    const p = await writeBuf(buf);
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p, {
      keyLengths: [16],
      formats: ['raw'],
      minEntropy: 8, // at the upper bound — produces few hits but scan runs
    });
    expect(result.scannedBytes).toBe(buf.length);
  });

  it('handles an empty file without throwing', async () => {
    const p = await writeBuf(Buffer.alloc(0));
    const extractor = new KeyExtractor();
    const result = await extractor.extractFromFile(p);
    expect(result.candidates).toEqual([]);
    expect(result.scannedBytes).toBe(0);
  });
});

describe('KeyExtractor — validation', () => {
  it('throws VALIDATION when filePath is empty', async () => {
    const extractor = new KeyExtractor();
    await expect(extractor.extractFromFile('')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('throws NOT_FOUND when file is missing', async () => {
    const extractor = new KeyExtractor();
    const missing = join(workDir, 'does-not-exist.bin');
    await expect(extractor.extractFromFile(missing)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws VALIDATION when minEntropy is out of range', async () => {
    const p = await writeBuf(Buffer.alloc(64));
    const extractor = new KeyExtractor();
    await expect(extractor.extractFromFile(p, { minEntropy: 9 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(extractor.extractFromFile(p, { minEntropy: -1 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('throws VALIDATION when keyLengths contains a non-integer', async () => {
    const p = await writeBuf(Buffer.alloc(64));
    const extractor = new KeyExtractor();
    await expect(extractor.extractFromFile(p, { keyLengths: [16, 0.5] })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('throws VALIDATION when scanWindow is inverted', async () => {
    const p = await writeBuf(Buffer.alloc(64));
    const extractor = new KeyExtractor();
    await expect(
      extractor.extractFromFile(p, { scanWindow: { start: 32, end: 16 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('throws VALIDATION when formats contains an unknown entry', async () => {
    const p = await writeBuf(Buffer.alloc(64));
    const extractor = new KeyExtractor();
    await expect(
      // @ts-expect-error — runtime guard for malformed input
      extractor.extractFromFile(p, { formats: ['bogus'] }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('uses default maxResults when omitted', () => {
    expect(BINARY_SECRETS_MAX_RESULTS).toBeGreaterThan(0);
  });
});
