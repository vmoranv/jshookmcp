/**
 * Tests for SigningBlockParser — the read-only APK Signing Block parser.
 *
 * Uses synthetic fixtures built on-demand from
 * `tests/fixtures/apk-packer/build-signing-block-fixtures.ts`. No real
 * keystore or APK signing tool involvement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';

import { SigningBlockParser } from '@modules/apk-packer/SigningBlockParser';
import {
  buildAll,
  type FixturePaths,
} from '@tests/fixtures/apk-packer/build-signing-block-fixtures';
import { ToolError } from '@errors/ToolError';

let paths: FixturePaths;

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

// Cleanup hint — fixtures stay in place for cross-test reuse.
afterAll(async () => {
  void rm; // marker so the import isn't pruned by oxlint
});
