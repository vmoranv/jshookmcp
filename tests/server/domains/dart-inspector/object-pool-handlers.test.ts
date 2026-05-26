/**
 * Domain handler tests for `dart_object_pool_dump`. Synthesizes fixtures
 * inline (no real APK / libapp.so binary) and exercises the handler's
 * argument coercion, error surfacing, and result shape per spec.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { DartInspectorHandlers } from '@server/domains/dart-inspector/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';
import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';

const KNOWN_HASH = '0000000000000000000000000000000000000000000000000000000000000003';

/** Build a tiny snapshot with `n` Smi slots (raw value = i+1). */
function buildSmiOnlyBlob(
  n: number,
  hashHex = KNOWN_HASH,
  features = 'product no-fp arm64',
): Buffer {
  const featBuf = Buffer.from(features + '\0', 'utf8');
  const headerSize = 0x28 + featBuf.length;
  const poolHeaderSize = 16; // 2.17 grammar pool header
  const pointerSize = 8;
  const blob = Buffer.alloc(headerSize + poolHeaderSize + n * pointerSize, 0);
  blob.writeUInt32LE(DART_SNAPSHOT_MAGIC, 0);
  blob.writeUInt32LE(2, 4); // full-aot
  Buffer.from(hashHex, 'hex').copy(blob, 0x08);
  featBuf.copy(blob, 0x28);
  for (let i = 0; i < n; i++) {
    const off = headerSize + poolHeaderSize + i * pointerSize;
    // Smi raw = (i+1) << 1, low bit = 0
    blob.writeBigUInt64LE(BigInt.asUintN(64, BigInt(i + 1) << 1n), off);
  }
  return blob;
}

let tmpDir: string;
let smiFixturePath: string;
let largeSmiFixturePath: string;
let unknownHashFixturePath: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pool-handler-'));
  smiFixturePath = join(tmpDir, 'smi-small.bin');
  await writeFile(smiFixturePath, buildSmiOnlyBlob(8));
  largeSmiFixturePath = join(tmpDir, 'smi-large.bin');
  await writeFile(largeSmiFixturePath, buildSmiOnlyBlob(32));
  unknownHashFixturePath = join(tmpDir, 'unknown-hash.bin');
  await writeFile(unknownHashFixturePath, buildSmiOnlyBlob(4, 'ff'.repeat(32)));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('DartInspectorHandlers.handleDartObjectPoolDump', () => {
  let handlers: DartInspectorHandlers;

  beforeAll(() => {
    handlers = new DartInspectorHandlers();
  });

  it('returns a successful dump with classified Smi slots', async () => {
    const resp = await handlers.handleDartObjectPoolDump({ filePath: smiFixturePath });
    const body = R.parse<{
      success: boolean;
      dump: { slots: Array<Record<string, unknown>>; grammar: Record<string, unknown> };
    }>(resp);
    expect(body.success).toBe(true);
    expect(body.dump.grammar).toMatchObject({ matched: true });
    expect(body.dump.slots.length).toBeGreaterThan(0);
    expect(body.dump.slots[0]).toMatchObject({ kind: 'smi', preview: '1', confidence: 'high' });
  });

  it('surfaces failure when filePath is missing', async () => {
    const resp = await handlers.handleDartObjectPoolDump({});
    const body = R.parse<{ success: boolean; error: string }>(resp);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('surfaces NOT_FOUND failure for a missing file', async () => {
    const resp = await handlers.handleDartObjectPoolDump({
      filePath: join(tmpDir, 'no-such-file.bin'),
    });
    const body = R.parse<{ success: boolean; error: string }>(resp);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found|ENOENT/i);
  });

  it('surfaces VALIDATION failure for negative maxSlots', async () => {
    const resp = await handlers.handleDartObjectPoolDump({
      filePath: smiFixturePath,
      maxSlots: -1,
    });
    const body = R.parse<{ success: boolean; error: string }>(resp);
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toMatch(/maxslots|positive/);
  });

  it('returns success:true with matched:false for an unknown snapshot grammar', async () => {
    const resp = await handlers.handleDartObjectPoolDump({ filePath: unknownHashFixturePath });
    const body = R.parse<{ success: boolean; dump: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.dump['grammar']).toMatchObject({ matched: false, sdkFamily: 'unknown' });
    expect(body.dump['slots']).toEqual([]);
  });

  it('preserves the truncated flag when maxSlots cuts the scan short', async () => {
    const resp = await handlers.handleDartObjectPoolDump({
      filePath: largeSmiFixturePath,
      maxSlots: 4,
    });
    const body = R.parse<{
      success: boolean;
      dump: { truncated: boolean; slots: unknown[] };
    }>(resp);
    expect(body.success).toBe(true);
    expect(body.dump.truncated).toBe(true);
    expect(body.dump.slots).toHaveLength(4);
  });

  it('accepts a pre-supplied fingerprint object and uses it for grammar selection', async () => {
    const resp = await handlers.handleDartObjectPoolDump({
      filePath: unknownHashFixturePath,
      fingerprint: { dartSdkRev: '2.17.0', targetArch: 'arm64' },
    });
    const body = R.parse<{ success: boolean; dump: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.dump['grammar']).toMatchObject({ matched: true, sdkFamily: '2.17' });
  });

  it('honours a forced grammar override via the `grammar` argument', async () => {
    const resp = await handlers.handleDartObjectPoolDump({
      filePath: unknownHashFixturePath,
      grammar: '2.17',
    });
    const body = R.parse<{ success: boolean; dump: Record<string, unknown> }>(resp);
    expect(body.success).toBe(true);
    expect(body.dump['grammar']).toMatchObject({ matched: true, sdkFamily: '2.17' });
  });
});
