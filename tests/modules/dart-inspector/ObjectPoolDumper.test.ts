/**
 * Tests for {@link ObjectPoolDumper}.
 *
 * All fixtures are synthesized inline — no real APK / libapp.so binary
 * is required. The synthetic snapshot reproduces just enough of the
 * Dart isolate snapshot header for {@link SnapshotFingerprint} to
 * locate it via byte-scan, and the slot region is hand-crafted so we
 * know which tag/cid each word should decode to.
 *
 * No vendor data is shipped. Hash `0000…0003` is a built-in
 * placeholder entry mapping to flutterVersion 3.0.0 / dartSdkRev 2.17.0,
 * which selects the 2.17 grammar (8-byte pointer, oneByteString cid=85,
 * twoByteString cid=86, mint cid=33, double cid=35, null cid=1).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { ObjectPoolDumper } from '@modules/dart-inspector/ObjectPoolDumper';
import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';
import { SnapshotFingerprint } from '@modules/dart-inspector/SnapshotFingerprint';

/** 2.17 grammar built-in cid mapping. Mirrors `cluster-grammar.ts`. */
const G_217 = {
  pointerSize: 8 as const,
  poolHeaderSize: 16,
  perSlotPrefixSize: 0,
  cids: {
    oneByteString: 85,
    twoByteString: 86,
    mint: 33,
    double: 35,
    objectPool: 91,
    null: 1,
    classRef: 70,
    functionRef: 73,
  },
};

const KNOWN_HASH = '0000000000000000000000000000000000000000000000000000000000000003';
const PRODUCT_FEATURES = 'product no-fp arm64';

interface SlotSpec {
  /** 'smi' | 'pointer' to a target object at `targetOffset` */
  kind:
    | { type: 'smi'; value: bigint }
    | { type: 'pointer'; targetOffset: number }
    | { type: 'rawWord'; raw: bigint };
}

/**
 * Build a synthetic snapshot blob laid out so the ObjectPoolDumper can
 * iterate it. The blob begins with the Dart snapshot header (magic,
 * kind, hash, features), then a poolHeaderSize-byte preamble, then the
 * caller-specified slots. Any "object headers" needed for pointer slots
 * are placed AFTER the slot table in the same blob; the caller's
 * `targetOffset` is relative to the blob start, NOT the snapshot
 * header.
 *
 * Returns: { blob, snapshotHeaderOffset }
 */
function buildSnapshotWithSlots(
  slots: SlotSpec[],
  payloadBytes = 0,
  hashHex = KNOWN_HASH,
): { blob: Buffer; snapshotHeaderOffset: number } {
  const headerSize = 0x28 + Buffer.byteLength(PRODUCT_FEATURES + '\0', 'utf8');
  const slotTableSize = slots.length * G_217.pointerSize;
  const blobSize = headerSize + G_217.poolHeaderSize + slotTableSize + payloadBytes;

  const blob = Buffer.alloc(blobSize, 0);
  // Snapshot header
  blob.writeUInt32LE(DART_SNAPSHOT_MAGIC, 0);
  blob.writeUInt32LE(2, 4); // full-aot
  Buffer.from(hashHex, 'hex').copy(blob, 0x08);
  Buffer.from(PRODUCT_FEATURES + '\0', 'utf8').copy(blob, 0x28);

  // Slot table starts at headerSize + poolHeaderSize
  const slotsStart = headerSize + G_217.poolHeaderSize;
  for (let i = 0; i < slots.length; i++) {
    const off = slotsStart + i * G_217.pointerSize;
    const spec = slots[i]!.kind;
    if (spec.type === 'smi') {
      // raw = value << 1 (low bit = 0)
      const raw = BigInt.asUintN(64, spec.value << 1n);
      blob.writeBigUInt64LE(raw, off);
    } else if (spec.type === 'pointer') {
      // raw = targetOffset | 1 (low bit set)
      const raw = BigInt.asUintN(64, BigInt(spec.targetOffset) | 1n);
      blob.writeBigUInt64LE(raw, off);
    } else {
      blob.writeBigUInt64LE(BigInt.asUintN(64, spec.raw), off);
    }
  }
  return { blob, snapshotHeaderOffset: 0 };
}

/** Place a stripped binary's snapshot blob at file offset 0. */
function writeBlobToFile(path: string, blob: Buffer): Promise<void> {
  return writeFile(path, blob);
}

/** Write a 4-byte cid header at `offset` inside `buf` (low 16 bits = cid). */
function writeCidHeader(buf: Buffer, offset: number, cid: number): void {
  buf.writeUInt32LE(cid & 0xffff, offset);
}

/** Append a 1-byte-string object header + bytes at `start` in `buf`. */
function placeOneByteString(buf: Buffer, start: number, ascii: string): number {
  writeCidHeader(buf, start, G_217.cids.oneByteString);
  // The dumper tries header sizes [8, 12, 16]; we use 8 so the string
  // begins immediately after the header word.
  const bytes = Buffer.from(ascii, 'latin1');
  bytes.copy(buf, start + 8);
  return start + 8 + bytes.length;
}

/** Place a mint object (header + int64) at `start`. */
function placeMint(buf: Buffer, start: number, value: bigint): number {
  writeCidHeader(buf, start, G_217.cids.mint);
  buf.writeBigInt64LE(value, start + 8);
  return start + 16;
}

/** Place a double object (header + 8-byte float) at `start`. */
function placeDouble(buf: Buffer, start: number, value: number): number {
  writeCidHeader(buf, start, G_217.cids.double);
  buf.writeDoubleLE(value, start + 8);
  return start + 16;
}

/** Place a null-class header (cid=1). */
function placeNull(buf: Buffer, start: number): number {
  writeCidHeader(buf, start, G_217.cids.null);
  return start + 8;
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pool-dump-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('ObjectPoolDumper.dump — slot decoding', () => {
  it('decodes positive Smi, zero Smi, and negative Smi (sign extension)', async () => {
    // 3 Smi slots: 42, 0, -7
    const slots: SlotSpec[] = [
      { kind: { type: 'smi', value: 42n } },
      { kind: { type: 'smi', value: 0n } },
      { kind: { type: 'smi', value: -7n } },
    ];
    const { blob } = buildSnapshotWithSlots(slots, 0);
    const path = join(tmpDir, 'smi-only.bin');
    await writeBlobToFile(path, blob);

    const dumper = new ObjectPoolDumper();
    const out = await dumper.dump(path);
    expect(out.grammar.matched).toBe(true);
    expect(out.slots.length).toBeGreaterThanOrEqual(3);
    expect(out.slots[0]).toMatchObject({ kind: 'smi', preview: '42', confidence: 'high' });
    expect(out.slots[1]).toMatchObject({ kind: 'smi', preview: '0' });
    expect(out.slots[2]).toMatchObject({ kind: 'smi', preview: '-7' });
  });

  it('classifies a string pointer slot and truncates preview to previewBytes', async () => {
    // 1 slot pointing at a long oneByteString placed after slot table
    const slots: SlotSpec[] = [{ kind: { type: 'pointer', targetOffset: 0 } }];
    const headerSize = 0x28 + Buffer.byteLength(PRODUCT_FEATURES + '\0', 'utf8');
    const targetAbs = headerSize + G_217.poolHeaderSize + G_217.pointerSize;
    slots[0] = { kind: { type: 'pointer', targetOffset: targetAbs } };
    const { blob } = buildSnapshotWithSlots(slots, 256);
    const longString = 'API_KEY_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_END';
    placeOneByteString(blob, targetAbs, longString);
    const path = join(tmpDir, 'string-slot.bin');
    await writeBlobToFile(path, blob);

    const dumper = new ObjectPoolDumper();
    const out = await dumper.dump(path, { previewBytes: 8 });
    const stringSlot = out.slots.find((s) => s.kind === 'string');
    expect(stringSlot).toBeDefined();
    expect(stringSlot?.preview).toBeDefined();
    expect((stringSlot?.preview ?? '').length).toBeLessThanOrEqual(8);
    expect(stringSlot?.cid).toBe(G_217.cids.oneByteString);
  });

  it('classifies a mint pointer slot and decodes the int64', async () => {
    const headerSize = 0x28 + Buffer.byteLength(PRODUCT_FEATURES + '\0', 'utf8');
    const targetAbs = headerSize + G_217.poolHeaderSize + G_217.pointerSize;
    const slots: SlotSpec[] = [{ kind: { type: 'pointer', targetOffset: targetAbs } }];
    const { blob } = buildSnapshotWithSlots(slots, 64);
    placeMint(blob, targetAbs, 1234567890123n);
    const path = join(tmpDir, 'mint-slot.bin');
    await writeBlobToFile(path, blob);

    const out = await new ObjectPoolDumper().dump(path);
    const slot = out.slots.find((s) => s.kind === 'mint');
    expect(slot).toBeDefined();
    expect(slot?.preview).toBe('1234567890123');
  });

  it('classifies a double pointer slot and decodes IEEE-754', async () => {
    const headerSize = 0x28 + Buffer.byteLength(PRODUCT_FEATURES + '\0', 'utf8');
    const targetAbs = headerSize + G_217.poolHeaderSize + G_217.pointerSize;
    const slots: SlotSpec[] = [{ kind: { type: 'pointer', targetOffset: targetAbs } }];
    const { blob } = buildSnapshotWithSlots(slots, 64);
    placeDouble(blob, targetAbs, 3.14159);
    const path = join(tmpDir, 'double-slot.bin');
    await writeBlobToFile(path, blob);

    const out = await new ObjectPoolDumper().dump(path);
    const slot = out.slots.find((s) => s.kind === 'double');
    expect(slot).toBeDefined();
    expect(slot?.preview).toBeDefined();
    expect(parseFloat(slot?.preview ?? '0')).toBeCloseTo(3.14159);
  });

  it('classifies a null pointer slot', async () => {
    const headerSize = 0x28 + Buffer.byteLength(PRODUCT_FEATURES + '\0', 'utf8');
    const targetAbs = headerSize + G_217.poolHeaderSize + G_217.pointerSize;
    const slots: SlotSpec[] = [{ kind: { type: 'pointer', targetOffset: targetAbs } }];
    const { blob } = buildSnapshotWithSlots(slots, 32);
    placeNull(blob, targetAbs);
    const path = join(tmpDir, 'null-slot.bin');
    await writeBlobToFile(path, blob);

    const out = await new ObjectPoolDumper().dump(path);
    const slot = out.slots.find((s) => s.kind === 'null');
    expect(slot).toBeDefined();
    expect(slot?.confidence).toBe('high');
  });

  it('emits unknown with rawBytes for a pointer outside the snapshot bounds', async () => {
    const slots: SlotSpec[] = [
      // Pointer to a very high offset that is outside the file
      { kind: { type: 'rawWord', raw: 0xffffffffffff0001n } },
    ];
    const { blob } = buildSnapshotWithSlots(slots, 0);
    const path = join(tmpDir, 'oob.bin');
    await writeBlobToFile(path, blob);

    const out = await new ObjectPoolDumper().dump(path);
    expect(out.slots.length).toBeGreaterThanOrEqual(1);
    const first = out.slots[0]!;
    expect(first.kind).toBe('unknown');
    expect(first.confidence).toBe('low');
    expect(first.rawBytes).toBeDefined();
    expect((first.rawBytes ?? '').length).toBeGreaterThan(0);
    expect(out.unknownSlotCount).toBeGreaterThanOrEqual(1);
  });

  it('emits unknown when the target has a cid not in knownCids', async () => {
    const headerSize = 0x28 + Buffer.byteLength(PRODUCT_FEATURES + '\0', 'utf8');
    const targetAbs = headerSize + G_217.poolHeaderSize + G_217.pointerSize;
    const slots: SlotSpec[] = [{ kind: { type: 'pointer', targetOffset: targetAbs } }];
    const { blob } = buildSnapshotWithSlots(slots, 32);
    // Place a header with a cid value (e.g. 9999) we never list.
    writeCidHeader(blob, targetAbs, 9999);
    const path = join(tmpDir, 'unknown-cid.bin');
    await writeBlobToFile(path, blob);

    const out = await new ObjectPoolDumper().dump(path);
    const slot = out.slots[0]!;
    expect(slot.kind).toBe('unknown');
    expect(slot.cid).toBe(9999);
    expect(slot.rawBytes).toBeDefined();
  });
});

describe('ObjectPoolDumper.dump — truncation + grammar selection', () => {
  it('truncates output at maxSlots and sets truncated:true', async () => {
    const slots: SlotSpec[] = Array.from({ length: 12 }, (_, i) => ({
      kind: { type: 'smi' as const, value: BigInt(i) },
    }));
    const { blob } = buildSnapshotWithSlots(slots, 0);
    const path = join(tmpDir, 'truncated.bin');
    await writeBlobToFile(path, blob);

    const out = await new ObjectPoolDumper().dump(path, { maxSlots: 4 });
    expect(out.slots).toHaveLength(4);
    expect(out.truncated).toBe(true);
  });

  it('returns matched:false + empty slots when no grammar applies (no fingerprint match, no override)', async () => {
    // Use an unknown hash so SnapshotFingerprint reports unknown:true.
    // arm64 features still get parsed but selectGrammar requires an
    // arm32/ia32 arch token to fall back, so grammar must remain unmatched.
    const slots: SlotSpec[] = [{ kind: { type: 'smi', value: 1n } }];
    const { blob } = buildSnapshotWithSlots(slots, 0, 'ff'.repeat(32));
    const path = join(tmpDir, 'unmatched-grammar.bin');
    await writeBlobToFile(path, blob);

    const out = await new ObjectPoolDumper().dump(path);
    expect(out.grammar.matched).toBe(false);
    expect(out.grammar.sdkFamily).toBe('unknown');
    expect(out.slots).toEqual([]);
    expect(out.pool.slotCount).toBe(0);
  });

  it('honours forced grammar override even when fingerprint does not match', async () => {
    const slots: SlotSpec[] = [{ kind: { type: 'smi', value: 99n } }];
    const { blob } = buildSnapshotWithSlots(slots, 0, 'aa'.repeat(32));
    const path = join(tmpDir, 'force-grammar.bin');
    await writeBlobToFile(path, blob);

    const out = await new ObjectPoolDumper().dump(path, { grammar: '2.17' });
    expect(out.grammar.matched).toBe(true);
    expect(out.grammar.sdkFamily).toBe('2.17');
    expect(out.slots[0]?.kind).toBe('smi');
  });

  it('uses pre-supplied fingerprint and skips internal SnapshotFingerprint', async () => {
    const slots: SlotSpec[] = [{ kind: { type: 'smi', value: 5n } }];
    const { blob } = buildSnapshotWithSlots(slots, 0);
    const path = join(tmpDir, 'pre-fp.bin');
    await writeBlobToFile(path, blob);

    const probe = new SnapshotFingerprint();
    const spy = vi.spyOn(probe, 'fingerprint');
    const dumper = new ObjectPoolDumper(probe);

    const out = await dumper.dump(path, {
      fingerprint: {
        magic: DART_SNAPSHOT_MAGIC,
        kind: 'full-aot',
        hash: KNOWN_HASH,
        features: ['arm64', 'product'],
        targetArch: 'arm64',
        isProduction: true,
        fileOffset: 0,
        source: 'byte-scan',
        unknown: false,
        flutterVersion: '3.0.0',
        dartSdkRev: '2.17.0',
      },
    });
    expect(spy).not.toHaveBeenCalled();
    expect(out.grammar.matched).toBe(true);
    expect(out.slots[0]?.kind).toBe('smi');
  });
});

describe('ObjectPoolDumper.dump — validation + budgets', () => {
  it('rejects an empty file path with VALIDATION', async () => {
    await expect(new ObjectPoolDumper().dump('')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects non-positive maxSlots with VALIDATION', async () => {
    const { blob } = buildSnapshotWithSlots([{ kind: { type: 'smi', value: 1n } }]);
    const path = join(tmpDir, 'maxslots-zero.bin');
    await writeBlobToFile(path, blob);
    await expect(new ObjectPoolDumper().dump(path, { maxSlots: 0 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(new ObjectPoolDumper().dump(path, { maxSlots: -5 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects negative previewBytes with VALIDATION', async () => {
    const { blob } = buildSnapshotWithSlots([{ kind: { type: 'smi', value: 1n } }]);
    const path = join(tmpDir, 'preview-neg.bin');
    await writeBlobToFile(path, blob);
    await expect(new ObjectPoolDumper().dump(path, { previewBytes: -1 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects missing files with NOT_FOUND', async () => {
    await expect(
      new ObjectPoolDumper().dump(join(tmpDir, 'no-such-file.bin')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects oversize files with PERMISSION', async () => {
    const { blob } = buildSnapshotWithSlots([{ kind: { type: 'smi', value: 1n } }]);
    const path = join(tmpDir, 'oversize.bin');
    await writeBlobToFile(path, blob);
    vi.resetModules();
    vi.doMock('@src/constants', async () => {
      const real = await vi.importActual<typeof import('@src/constants')>('@src/constants');
      return {
        ...real,
        DART_SNAPSHOT_MAX_FILE_BYTES: 8,
      };
    });
    const { ObjectPoolDumper: D } = await import('@modules/dart-inspector/ObjectPoolDumper');
    await expect(new D().dump(path)).rejects.toMatchObject({ code: 'PERMISSION' });
    vi.doUnmock('@src/constants');
    vi.resetModules();
  });

  it('throws TIMEOUT when the wall-clock budget is exhausted', async () => {
    // Force the dumper to spend its budget by setting DART_PP_MAX_DUMP_DURATION_MS to a negative number.
    const { blob } = buildSnapshotWithSlots(
      Array.from({ length: 8 }, () => ({ kind: { type: 'smi' as const, value: 1n } })),
    );
    const path = join(tmpDir, 'tiny-budget.bin');
    await writeBlobToFile(path, blob);

    vi.resetModules();
    vi.doMock('@src/constants', async () => {
      const real = await vi.importActual<typeof import('@src/constants')>('@src/constants');
      return {
        ...real,
        DART_PP_MAX_DUMP_DURATION_MS: -1, // negative budget → any elapsed time exceeds it
      };
    });
    const { ObjectPoolDumper: D } = await import('@modules/dart-inspector/ObjectPoolDumper');
    await expect(new D().dump(path)).rejects.toMatchObject({ code: 'TIMEOUT' });
    vi.doUnmock('@src/constants');
    vi.resetModules();
  });
});
