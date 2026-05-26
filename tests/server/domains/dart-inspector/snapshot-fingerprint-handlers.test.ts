/**
 * Domain handler tests for `dart_snapshot_header_parse` and
 * `dart_version_fingerprint`. Synthesizes fixtures inline so the tests
 * do not depend on real APK/SO binaries.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { DartInspectorHandlers } from '@server/domains/dart-inspector/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';
import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';
import { resetUserTableCacheForTests } from '@modules/dart-inspector/snapshot-version-table';

const KNOWN_HASH = '0000000000000000000000000000000000000000000000000000000000000003';

function makeSnapshotBlob(hashHex = KNOWN_HASH, features = 'product no-fp arm64'): Buffer {
  const hashBytes = Buffer.from(hashHex, 'hex');
  const feat = Buffer.from(features + '\0', 'utf8');
  const buf = Buffer.alloc(0x28 + feat.length + 8, 0);
  buf.writeUInt32LE(DART_SNAPSHOT_MAGIC, 0);
  buf.writeUInt32LE(2, 4); // full-aot
  hashBytes.copy(buf, 0x08);
  feat.copy(buf, 0x28);
  return buf;
}

/** Stripped binary with snapshot blob at offset 256. */
function buildStrippedFixture(hashHex = KNOWN_HASH): Buffer {
  const blob = makeSnapshotBlob(hashHex);
  const buf = Buffer.alloc(256 + blob.length, 0x33);
  blob.copy(buf, 256);
  return buf;
}

let tmpDir: string;
let strippedPath: string;
let unknownHashPath: string;
let nonDartPath: string;
let customTablePath: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'snap-handler-'));

  strippedPath = join(tmpDir, 'stripped-known.bin');
  await writeFile(strippedPath, buildStrippedFixture());

  unknownHashPath = join(tmpDir, 'stripped-unknown.bin');
  await writeFile(unknownHashPath, buildStrippedFixture('ee'.repeat(32)));

  nonDartPath = join(tmpDir, 'non-dart.bin');
  await writeFile(nonDartPath, Buffer.alloc(8192, 0x42));

  customTablePath = join(tmpDir, 'custom.json');
  await writeFile(
    customTablePath,
    JSON.stringify({
      ['ee'.repeat(32)]: {
        flutterVersion: 'custom-3.99.0',
        engineCommit: 'custom-engine-xyz',
      },
    }),
  );
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  resetUserTableCacheForTests();
});

describe('DartInspectorHandlers.handleDartSnapshotHeaderParse', () => {
  let handlers: DartInspectorHandlers;

  beforeAll(() => {
    handlers = new DartInspectorHandlers();
  });

  it('returns parsed header for a stripped binary (byte-scan)', async () => {
    const resp = await handlers.handleDartSnapshotHeaderParse({ filePath: strippedPath });
    const body = R.parse<{ success: boolean; snapshot: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.snapshot['kind']).toBe('full-aot');
    expect(body.snapshot['hash']).toBe(KNOWN_HASH);
    expect(body.snapshot['source']).toBe('byte-scan');
    expect(body.snapshot['targetArch']).toBe('arm64');
    expect(body.snapshot['isProduction']).toBe(true);
  });

  it('returns failure when filePath is missing', async () => {
    const resp = await handlers.handleDartSnapshotHeaderParse({});
    const body = R.parse<{ success: boolean; error: string }>(resp);
    expect(body.success).toBe(false);
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('returns failure when file does not exist', async () => {
    const resp = await handlers.handleDartSnapshotHeaderParse({
      filePath: join(tmpDir, 'no-such-file.bin'),
    });
    const body = R.parse<{ success: boolean; error: string }>(resp);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found|ENOENT/i);
  });

  it('returns unknown payload (not error) for a non-Dart binary', async () => {
    const resp = await handlers.handleDartSnapshotHeaderParse({ filePath: nonDartPath });
    const body = R.parse<{ success: boolean; snapshot: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.snapshot['kind']).toBe('unknown');
    expect(body.snapshot['hash']).toBe('');
  });

  it('honors maxScanBytes=0 (caller forces unknown)', async () => {
    const resp = await handlers.handleDartSnapshotHeaderParse({
      filePath: strippedPath,
      maxScanBytes: 0,
    });
    const body = R.parse<{ success: boolean; snapshot: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.snapshot['kind']).toBe('unknown');
  });

  it('rejects negative maxScanBytes', async () => {
    const resp = await handlers.handleDartSnapshotHeaderParse({
      filePath: strippedPath,
      maxScanBytes: -5,
    });
    const body = R.parse<{ success: boolean; error: string }>(resp);
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toMatch(/maxscanbytes|>= 0/);
  });
});

describe('DartInspectorHandlers.handleDartVersionFingerprint', () => {
  let handlers: DartInspectorHandlers;

  beforeAll(() => {
    handlers = new DartInspectorHandlers();
    resetUserTableCacheForTests();
  });

  it('returns Flutter version when the hash is in the built-in table', async () => {
    const resp = await handlers.handleDartVersionFingerprint({ filePath: strippedPath });
    const body = R.parse<{ success: boolean; fingerprint: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.fingerprint['unknown']).toBe(false);
    expect(body.fingerprint['flutterVersion']).toBe('3.0.0');
  });

  it('returns unknown:true for hashes not in any table', async () => {
    const resp = await handlers.handleDartVersionFingerprint({ filePath: unknownHashPath });
    const body = R.parse<{ success: boolean; fingerprint: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.fingerprint['unknown']).toBe(true);
    expect(body.fingerprint['flutterVersion']).toBeUndefined();
  });

  it('merges entries from customTablePath', async () => {
    const resp = await handlers.handleDartVersionFingerprint({
      filePath: unknownHashPath,
      customTablePath,
    });
    const body = R.parse<{ success: boolean; fingerprint: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.fingerprint['unknown']).toBe(false);
    expect(body.fingerprint['flutterVersion']).toBe('custom-3.99.0');
  });

  it('strips features when includeFeatures=false', async () => {
    const resp = await handlers.handleDartVersionFingerprint({
      filePath: strippedPath,
      includeFeatures: false,
    });
    const body = R.parse<{
      success: boolean;
      fingerprint: { features: unknown };
    }>(resp);
    expect(body.fingerprint.features).toEqual([]);
  });

  it('reports unknown for non-Dart binaries (no throw)', async () => {
    const resp = await handlers.handleDartVersionFingerprint({ filePath: nonDartPath });
    const body = R.parse<{ success: boolean; fingerprint: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.fingerprint['unknown']).toBe(true);
    expect(body.fingerprint['kind']).toBe('unknown');
  });

  it('returns RUNTIME error for malformed custom table JSON', async () => {
    const badPath = join(tmpDir, 'bad.json');
    await writeFile(badPath, '{bogus');
    const resp = await handlers.handleDartVersionFingerprint({
      filePath: strippedPath,
      customTablePath: badPath,
    });
    const body = R.parse<{ success: boolean; error: string }>(resp);
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toMatch(/json|invalid/);
  });

  it('falls back to default tablePath when customTablePath is empty string', async () => {
    const resp = await handlers.handleDartVersionFingerprint({
      filePath: strippedPath,
      customTablePath: '',
    });
    const body = R.parse<{ success: boolean; fingerprint: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.fingerprint['flutterVersion']).toBe('3.0.0');
  });
});
