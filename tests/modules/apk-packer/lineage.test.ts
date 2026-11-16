/**
 * A-phase (close-descoped-behaviors): real v3 proof-of-rotation lineage decode.
 * Dual path: a decodable 2-level chain yields levels.length===2; the legacy
 * sentinel fixture still falls back to levels===[] (SigningBlockParser.test.ts:87).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SigningBlockParser,
  decodeProofOfRotationBytes,
} from '@modules/apk-packer/SigningBlockParser';
import {
  buildAll,
  buildTwoLevelLineage,
  type FixturePaths,
} from '@tests/fixtures/apk-packer/build-signing-block-fixtures';

let paths: FixturePaths;

beforeAll(async () => {
  paths = await buildAll();
});

describe('decodeProofOfRotationBytes', () => {
  it('decodes a 2-level lineage with cert fingerprint / flags / algorithm', () => {
    const levels = decodeProofOfRotationBytes(buildTwoLevelLineage());
    expect(levels).toHaveLength(2);
    for (const lvl of levels) {
      expect(lvl.certificate.sha256Fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof lvl.flags).toBe('number');
      expect(lvl.signedDataSigAlgorithm).toBe('RSA_PKCS1_V1_5_SHA256');
    }
    expect(levels[0]!.flags).toBe(0);
    expect(levels[1]!.flags).toBe(1);
    // distinct certs -> distinct fingerprints
    expect(levels[0]!.certificate.sha256Fingerprint).not.toBe(
      levels[1]!.certificate.sha256Fingerprint,
    );
  });

  it('returns [] for the legacy sentinel / malformed / empty payloads', () => {
    expect(decodeProofOfRotationBytes(Buffer.from('cafebabe', 'hex'))).toEqual([]);
    expect(decodeProofOfRotationBytes(Buffer.alloc(0))).toEqual([]);
    // truncated header (u32 sdLen claims more than available)
    const truncated = Buffer.alloc(4);
    truncated.writeUInt32LE(999, 0);
    expect(decodeProofOfRotationBytes(truncated)).toEqual([]);
  });
});

describe('SigningBlockParser v3 lineage (end-to-end stash)', () => {
  it('decodes the 2-level lineage embedded in v3-rotation-lineage.apk', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.v3RotationLineage);
    expect(report.schemes.v3).toBeDefined();
    const rotation = report.schemes.v3!.keyRotation;
    expect(rotation).toBeDefined();
    expect(rotation!.levels).toHaveLength(2);
    expect(rotation!.levels[0]!.certificate.sha256Fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('legacy v3-rotation.apk (sentinel) still yields levels===[]', async () => {
    const parser = new SigningBlockParser();
    const report = await parser.parse(paths.v3Rotation);
    expect(report.schemes.v3!.keyRotation).toBeDefined();
    expect(report.schemes.v3!.keyRotation!.levels).toEqual([]);
  });
});
