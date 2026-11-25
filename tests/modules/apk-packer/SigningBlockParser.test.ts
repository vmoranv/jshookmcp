/**
 * Tests for SigningBlockParser — the read-only APK Signing Block parser.
 *
 * Uses synthetic fixtures built on-demand from
 * `tests/fixtures/apk-packer/build-signing-block-fixtures.ts`. No real
 * keystore or APK signing tool involvement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SigningBlockParser } from '@modules/apk-packer/SigningBlockParser';
import { BLOCK_ID_V3 } from '@modules/apk-packer/signing-block-types';
import {
  buildAll,
  type FixturePaths,
} from '@tests/fixtures/apk-packer/build-signing-block-fixtures';
import { ToolError } from '@errors/ToolError';

let paths: FixturePaths;

const SIG_BLOCK_MAGIC = Buffer.from('APK Sig Block 42', 'utf8');
const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

interface BlockLayout {
  blockStart: number;
  pairsStart: number;
  pairsEnd: number;
  sizeOfBlock: number;
}

function locateSigningBlock(buf: Buffer): BlockLayout {
  const magicAt = buf.indexOf(SIG_BLOCK_MAGIC);
  if (magicAt < 0) throw new Error('fixture has no signing-block magic');
  const sizeOfBlock = Number(buf.readBigUInt64LE(magicAt - 8));
  const blockStart = magicAt + 16 - 8 - sizeOfBlock;
  return { blockStart, pairsStart: blockStart + 8, pairsEnd: magicAt - 8, sizeOfBlock };
}

function findPair(
  buf: Buffer,
  layout: BlockLayout,
  id: number,
): { start: number; end: number } | undefined {
  let cursor = layout.pairsStart;
  while (cursor + 12 <= layout.pairsEnd) {
    const pairSize = Number(buf.readBigUInt64LE(cursor));
    const end = cursor + 8 + pairSize;
    if (buf.readUInt32LE(cursor + 8) === id) return { start: cursor, end };
    cursor = end;
  }
  return undefined;
}

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.subarray(i, i + 4).equals(EOCD_SIGNATURE)) return i;
  }
  return -1;
}

let scratchDir: string;

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'sigblock-dupe-'));
});

afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

beforeAll(async () => {
  paths = await buildAll();
});

afterAll(async () => {
  // Fixtures are regenerated on demand; leave them for inspection.
});

describe('SigningBlockParser — no signing block', () => {
  it('plain ZIP returns found=false with no anomalies', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.noSigblock);
    expect(report.signingBlock.found).toBe(false);
    expect(report.schemes).toEqual({});
    expect(report.anomalies).toHaveLength(0);
  });

  it('corrupt EOCD surfaces an eocd-not-found anomaly', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.corruptEocd);
    expect(report.signingBlock.found).toBe(false);
    const kinds = report.anomalies.map((a) => a.kind);
    expect(kinds).toContain('eocd-not-found');
  });
});

describe('SigningBlockParser — v2-only', () => {
  it('parses a v2 signer and produces a SHA-256 fingerprint', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.v2Only);
    expect(report.signingBlock.found).toBe(true);
    expect(report.signingBlock.magic).toBe('APK Sig Block 42');
    expect(report.schemes.v2).toBeDefined();
    expect(report.schemes.v2!.signers).toHaveLength(1);
    const signer = report.schemes.v2!.signers[0]!;
    expect(signer.certificates).toHaveLength(1);
    expect(signer.certificates[0]!.sha256Fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(signer.certificates[0]!.derLength).toBe(48);
    expect(signer.digests.length).toBeGreaterThan(0);
    expect(signer.digests[0]!.algorithm).toBe('RSA_PKCS1_V1_5_SHA256');
    expect(report.schemes.v3).toBeUndefined();
  });

  it('emits no anomalies on a clean v2-only APK', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.v2Only);
    expect(report.anomalies).toHaveLength(0);
  });
});

describe('SigningBlockParser — v3 with rotation', () => {
  it('produces both v2 and v3 entries when both schemes are present', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.v3Rotation);
    expect(report.schemes.v2).toBeDefined();
    expect(report.schemes.v3).toBeDefined();
    expect(report.schemes.v3!.signers).toHaveLength(1);
    const v3signer = report.schemes.v3!.signers[0]!;
    expect(v3signer.minSdkVersion).toBe(24);
    expect(v3signer.maxSdkVersion).toBe(34);
  });

  it('records the proofOfRotation attribute when present', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.v3Rotation);
    expect(report.schemes.v3!.keyRotation).toBeDefined();
    // We don't decode raw lineage bytes in this version; the marker is enough.
    expect(report.schemes.v3!.keyRotation!.levels).toEqual([]);
    // Attribute itself is enumerated in the signedData attributes list.
    const v3signer = report.schemes.v3!.signers[0]!;
    const attrIds = v3signer.additionalAttributes.map((a) => a.id);
    expect(attrIds).toContain('0x3ba06f8c');
  });
});

describe('SigningBlockParser — extra block anomaly', () => {
  it('flags the 0x42424242 block as extra-block-anomaly', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.extraBlockAnomaly);
    expect(report.signingBlock.found).toBe(true);
    const kinds = report.anomalies.map((a) => a.kind);
    expect(kinds).toContain('extra-block-anomaly');
    const unknownIds = report.unknownBlocks.map((u) => u.id);
    expect(unknownIds).toContain('0x42424242');
    // Warnings should mention the non-standard nature for analyst visibility.
    expect(report.warnings.join('\n')).toMatch(/non-standard|unknown/i);
  });

  it('still surfaces the v2 signer alongside the extra block', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.extraBlockAnomaly);
    expect(report.schemes.v2).toBeDefined();
    expect(report.schemes.v2!.signers).toHaveLength(1);
  });
});

describe('SigningBlockParser — input validation', () => {
  it('rejects a missing file with NOT_FOUND', async () => {
    const parser = new SigningBlockParser();
    await expect(parser.parse('/this/path/does/not/exist.apk')).rejects.toBeInstanceOf(ToolError);
  });

  it('rejects an empty path with VALIDATION', async () => {
    const parser = new SigningBlockParser();
    await expect(parser.parse('')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a directory with VALIDATION', async () => {
    const parser = new SigningBlockParser();
    // The fixture directory itself is a directory.
    const fixtureDir = paths.noSigblock.replace(/[\\/]no-sigblock\.zip$/, '');
    await expect(parser.parse(fixtureDir)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('does not mutate the input file', async () => {
    const parser = new SigningBlockParser();
    const { stat } = await import('node:fs/promises');
    const before = await stat(paths.v2Only);
    await parser.parse(paths.v2Only);
    const after = await stat(paths.v2Only);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});

describe('SigningBlockParser — report shape', () => {
  it('always includes apkPath and fileSize', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.v2Only);
    expect(report.apkPath).toBe(paths.v2Only);
    expect(report.fileSize).toBeGreaterThan(0);
  });

  it('uses lowercase 0x-prefixed hex for block IDs', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.extraBlockAnomaly);
    for (const u of report.unknownBlocks) {
      expect(u.id).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });
});

describe('SigningBlockParser — hardened parsing', () => {
  it('merges duplicate v3 blocks instead of dropping earlier signers', async () => {
    const original = await readFile(paths.v3Rotation);
    const layout = locateSigningBlock(original);
    const v3Pair = findPair(original, layout, BLOCK_ID_V3);
    expect(v3Pair).toBeDefined();
    const duplicate = Buffer.from(original.subarray(v3Pair!.start, v3Pair!.end));

    const mutated = Buffer.concat([
      original.subarray(0, layout.pairsEnd),
      duplicate,
      original.subarray(layout.pairsEnd),
    ]);
    const newSize = layout.sizeOfBlock + duplicate.length;
    mutated.writeBigUInt64LE(BigInt(newSize), layout.blockStart);
    mutated.writeBigUInt64LE(BigInt(newSize), layout.pairsEnd + duplicate.length);
    const eocd = findEocd(mutated);
    expect(eocd).toBeGreaterThan(0);
    const originalCentralDir = layout.pairsEnd + 24;
    mutated.writeUInt32LE(originalCentralDir + duplicate.length, eocd + 16);

    const apkPath = join(scratchDir, 'duplicate-v3.apk');
    await writeFile(apkPath, mutated);

    const report = await new SigningBlockParser().parse(apkPath);
    expect(report.schemes.v3?.signers).toHaveLength(2);
    expect(report.anomalies.map((a) => a.kind)).toContain('duplicate-scheme');
  });

  it('degrades an oversized pair length into a warning (no throw)', async () => {
    const original = await readFile(paths.v2Only);
    const layout = locateSigningBlock(original);
    const mutated = Buffer.from(original);
    // Corrupt the high half of the first pair's u64 size field.
    mutated.writeUInt32LE(0xffffffff, layout.pairsStart + 4);
    const apkPath = join(scratchDir, 'oversized-pair.apk');
    await writeFile(apkPath, mutated);

    const report = await new SigningBlockParser().parse(apkPath);
    expect(report.signingBlock.found).toBe(true);
    expect(report.warnings.join('\n')).toMatch(/Unreadable ID-value pair header/i);
  });

  it('degrades a malformed signer payload into a warning (no throw)', async () => {
    const original = await readFile(paths.v3Rotation);
    const layout = locateSigningBlock(original);
    const v3Pair = findPair(original, layout, BLOCK_ID_V3);
    expect(v3Pair).toBeDefined();
    const mutated = Buffer.from(original);
    // signersLen lives at valueStart (= pair start + 12).
    mutated.writeUInt32LE(0xffffff00, v3Pair!.start + 12);
    const apkPath = join(scratchDir, 'bad-signers-len.apk');
    await writeFile(apkPath, mutated);

    const report = await new SigningBlockParser().parse(apkPath);
    expect(report.signingBlock.found).toBe(true);
    expect(report.schemes.v3).toBeUndefined();
    expect(report.warnings.join('\n')).toMatch(/Skipped malformed block 0xf05368c0/i);
  });
});
