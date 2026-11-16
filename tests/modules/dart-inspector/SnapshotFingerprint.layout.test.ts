/**
 * Tests for SnapshotFingerprint's dual-layout header decode.
 *
 * Two header layouts exist in the wild:
 *  - Layout A (Phrack #71): +0x04 kind(u32), +0x08 hash[32], +0x28 features.
 *  - Layout B (dart-sdk variant): +0x0C kind(int64, low u32 used),
 *    +0x14 hash[32], +0x34 features.
 *
 * Both are built here as PURE Buffer fixtures (no real libapp.so) and written
 * to a temp file; parseHeader() must decode the correct kind + hash from each.
 * This exercises the magic-scan → readHeader path through the public API.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { SnapshotFingerprint } from '@modules/dart-inspector/SnapshotFingerprint';
import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';

const HASH_A = 'a1'.repeat(32);
const HASH_B = 'b2'.repeat(32);
const FEATURES_A = 'product no-fp arm64';
const FEATURES_B = 'product no-fp x64';

const OFF = {
  a: { kind: 0x04, hash: 0x08, features: 0x28 },
  b: { kind: 0x0c, hash: 0x14, features: 0x34 },
} as const;

/** Layout A fixture: kind is a uint32 at +0x04. */
function makeLayoutA(): Buffer {
  const features = Buffer.from(FEATURES_A + '\0', 'utf8');
  const buf = Buffer.alloc(OFF.a.features + features.length + 8, 0);
  buf.writeUInt32LE(DART_SNAPSHOT_MAGIC, 0);
  buf.writeUInt32LE(3, OFF.a.kind); // full-jit
  Buffer.from(HASH_A, 'hex').copy(buf, OFF.a.hash);
  features.copy(buf, OFF.a.features);
  return buf;
}

/** Layout B fixture: kind is an int64 (low u32) at +0x0C, hash at +0x14. */
function makeLayoutB(): Buffer {
  const features = Buffer.from(FEATURES_B + '\0', 'utf8');
  const buf = Buffer.alloc(OFF.b.features + features.length + 8, 0);
  buf.writeUInt32LE(DART_SNAPSHOT_MAGIC, 0);
  buf.writeBigUInt64LE(2n, OFF.b.kind); // full-aot, stored as int64
  Buffer.from(HASH_B, 'hex').copy(buf, OFF.b.hash);
  features.copy(buf, OFF.b.features);
  return buf;
}

let tmpDir: string;
let aPath: string;
let bPath: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'snapshot-layout-'));
  aPath = join(tmpDir, 'layout-a.bin');
  bPath = join(tmpDir, 'layout-b.bin');
  await writeFile(aPath, makeLayoutA());
  await writeFile(bPath, makeLayoutB());
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('SnapshotFingerprint dual-layout decode', () => {
  it('decodes layout A (kind u32 @ +0x04, hash @ +0x08, features @ +0x28)', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(aPath);
    expect(out.magic).toBe(DART_SNAPSHOT_MAGIC);
    expect(out.kind).toBe('full-jit');
    expect(out.hash).toBe(HASH_A);
    expect(out.features).toContain('arm64');
    expect(out.targetArch).toBe('arm64');
    expect(out.isProduction).toBe(true);
  });

  it('decodes layout B (kind int64 low-u32 @ +0x0C, hash @ +0x14, features @ +0x34)', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(bPath);
    expect(out.magic).toBe(DART_SNAPSHOT_MAGIC);
    expect(out.kind).toBe('full-aot');
    expect(out.hash).toBe(HASH_B);
    expect(out.features).toContain('x64');
    expect(out.targetArch).toBe('x64');
    expect(out.isProduction).toBe(true);
  });
});
