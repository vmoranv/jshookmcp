/**
 * Tests for {@link SnapshotFingerprint}.
 *
 * Fixtures are synthesized inline (no real APKs, no real libapp.so)
 * — just enough of an ELF skeleton for `parseHeader` to exercise both
 * the symbol-resolution and byte-scan paths. The headers themselves
 * are written exactly as Phrack #71 documents: magic + kind + 32-byte
 * hash + NUL-terminated features.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { SnapshotFingerprint } from '@modules/dart-inspector/SnapshotFingerprint';
import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';
import { ToolError } from '@errors/ToolError';

const DEFAULT_HASH_HEX = '0000000000000000000000000000000000000000000000000000000000000003';

interface SnapshotBlobOpts {
  hashHex?: string;
  kind?: number;
  features?: string;
}

function makeSnapshotBlob(opts: SnapshotBlobOpts = {}): Buffer {
  const hashHex = opts.hashHex ?? DEFAULT_HASH_HEX;
  if (hashHex.length !== 64) throw new Error('hashHex must be 64 chars');
  const hashBytes = Buffer.from(hashHex, 'hex');
  if (hashBytes.length !== 32) throw new Error('hashHex must decode to 32 bytes');
  const features = opts.features ?? 'product no-fp arm64';
  const featuresBuf = Buffer.from(features + '\0', 'utf8');
  const buf = Buffer.alloc(0x28 + featuresBuf.length + 8, 0);
  buf.writeUInt32LE(DART_SNAPSHOT_MAGIC, 0);
  buf.writeUInt32LE(opts.kind ?? 2, 4);
  hashBytes.copy(buf, 0x08);
  featuresBuf.copy(buf, 0x28);
  return buf;
}

interface ElfWithSymbolOpts extends SnapshotBlobOpts {
  withSymbol: boolean;
  /** Pad before snapshot blob to test byte-scan offset reporting. */
  padBeforeSnapshot?: number;
  /** Pretend ELF (write the 0x7f ELF magic + e_ident); leave shoff at 0 when withSymbol=false. */
  pretendElf?: boolean;
}

/**
 * Synthesize a minimal ELF64 with a single .dynsym entry pointing at our
 * snapshot blob. We hand-craft just enough of the section header table to
 * let `SnapshotFingerprint.parseHeader` walk it.
 *
 * Layout we emit:
 *   0x000  ELF64 header (64 bytes)
 *   0x040  pad (alignment)
 *   0x080  snapshot blob
 *   ...    .dynstr (single string)
 *   ...    .dynsym (NULL + 1 entry pointing at snapshot blob)
 *   ...    SHT (3 entries: NULL, DYNSYM, DYNSTR)
 */
function buildElfWithSymbol(opts: ElfWithSymbolOpts): Buffer {
  const snapshot = makeSnapshotBlob(opts);
  const pad = opts.padBeforeSnapshot ?? 0;
  const snapshotOffset = 0x80 + pad;
  const snapshotEnd = snapshotOffset + snapshot.length;

  // .dynstr at next 8-byte aligned offset
  const dynstrOffset = alignUp(snapshotEnd, 8);
  const symName = '_kDartIsolateSnapshotData';
  const dynstr = Buffer.concat([Buffer.from('\0', 'utf8'), Buffer.from(symName + '\0', 'utf8')]);

  // .dynsym at next 8-byte aligned offset; 2 entries (null + our sym) * 24 = 48 bytes
  const dynsymOffset = alignUp(dynstrOffset + dynstr.length, 8);
  const dynsym = Buffer.alloc(48, 0);
  // Entry 0: null (already zeros)
  // Entry 1: st_name=1 (skip the leading null), st_info=0, st_other=0,
  //   st_shndx=4 (we'll place snapshot section there), st_value=<snapshotOffset>, st_size=<snapshot.length>
  dynsym.writeUInt32LE(1, 24 + 0); // st_name
  // st_info/other (bytes 4..5) left zero
  dynsym.writeUInt16LE(4, 24 + 6); // st_shndx
  dynsym.writeBigUInt64LE(BigInt(snapshotOffset), 24 + 8); // st_value (we'll set sh_addr == sh_offset → offset translation is identity)
  dynsym.writeBigUInt64LE(BigInt(snapshot.length), 24 + 16);

  // Section header table: 5 entries (NULL, .dynsym, .dynstr, .shstrtab(unused), .snapshot)
  // We keep the .shstrtab section optional — readShdr only consults sh_type/sh_offset/sh_size.
  const shtOffset = alignUp(dynsymOffset + dynsym.length, 8);
  const shentSize = 64; // ELF64
  const numSections = 5;
  const sht = Buffer.alloc(shentSize * numSections, 0);
  // Section 0: NULL
  // Section 1: .dynsym
  writeShdr64(sht, 1, {
    type: 11,
    addr: 0,
    offset: dynsymOffset,
    size: dynsym.length,
    link: 2, // sh_link → .dynstr
    entsize: 24,
  });
  // Section 2: .dynstr
  writeShdr64(sht, 2, {
    type: 3,
    addr: 0,
    offset: dynstrOffset,
    size: dynstr.length,
    link: 0,
    entsize: 0,
  });
  // Section 3: PROGBITS placeholder (unused)
  writeShdr64(sht, 3, { type: 1, addr: 0, offset: 0, size: 0, link: 0, entsize: 0 });
  // Section 4: PROGBITS for snapshot
  writeShdr64(sht, 4, {
    type: 1,
    addr: snapshotOffset, // identity addr → offset
    offset: snapshotOffset,
    size: snapshot.length,
    link: 0,
    entsize: 0,
  });

  // Compose final file
  const fileSize = shtOffset + sht.length;
  const file = Buffer.alloc(fileSize, 0);

  // ELF64 header
  file.write('\x7fELF', 0, 'binary');
  file.writeUInt8(2, 4); // EI_CLASS = ELF64
  file.writeUInt8(1, 5); // EI_DATA = LSB
  file.writeUInt8(1, 6); // EI_VERSION
  // e_type (2 bytes @ 0x10), e_machine (@0x12), e_version (@0x14)
  file.writeUInt16LE(3, 0x10); // ET_DYN
  file.writeUInt16LE(0xb7, 0x12); // EM_AARCH64
  file.writeUInt32LE(1, 0x14);
  if (opts.withSymbol) {
    file.writeBigUInt64LE(BigInt(shtOffset), 0x28);
  } else {
    // No symbol path: keep e_shoff at 0 so resolveSnapshotSymbol bails out.
    // The snapshot blob is still embedded at snapshotOffset so byte-scan finds it.
  }
  file.writeUInt16LE(shentSize, 0x3a);
  file.writeUInt16LE(numSections, 0x3c);

  snapshot.copy(file, snapshotOffset);
  dynstr.copy(file, dynstrOffset);
  dynsym.copy(file, dynsymOffset);
  if (opts.withSymbol) sht.copy(file, shtOffset);
  return file;
}

interface Shdr64Fields {
  type: number;
  addr: number;
  offset: number;
  size: number;
  link: number;
  entsize: number;
}

function writeShdr64(table: Buffer, index: number, f: Shdr64Fields): void {
  const base = index * 64;
  table.writeUInt32LE(0, base + 0x00); // sh_name (unused — we don't have .shstrtab)
  table.writeUInt32LE(f.type, base + 0x04);
  table.writeBigUInt64LE(0n, base + 0x08); // sh_flags
  table.writeBigUInt64LE(BigInt(f.addr), base + 0x10);
  table.writeBigUInt64LE(BigInt(f.offset), base + 0x18);
  table.writeBigUInt64LE(BigInt(f.size), base + 0x20);
  table.writeUInt32LE(f.link, base + 0x28);
  table.writeUInt32LE(0, base + 0x2c); // sh_info
  table.writeBigUInt64LE(0n, base + 0x30);
  table.writeBigUInt64LE(BigInt(f.entsize), base + 0x38);
}

function alignUp(v: number, align: number): number {
  return Math.ceil(v / align) * align;
}

/** Build a stripped (non-ELF) binary that just contains the snapshot blob at `padBefore`. */
function buildStrippedBlob(padBefore: number, opts: SnapshotBlobOpts = {}): Buffer {
  const snapshot = makeSnapshotBlob(opts);
  const buf = Buffer.alloc(padBefore + snapshot.length, 0xaa);
  snapshot.copy(buf, padBefore);
  return buf;
}

let tmpDir: string;
let elfSymbolPath: string;
let strippedBlobPath: string;
let randomNoisePath: string;
let elfWithKindFullPath: string;
let elfWithKindJitPath: string;
let elfWithKindCorePath: string;
let elfWithKindZeroPath: string;
let elfWithArm32Path: string;
let elfWithX64Path: string;
let elfWithIa32Path: string;
let elfWithRiscvPath: string;
let elfNoProductPath: string;
let oversizePath: string;
let elfBoundaryScanPath: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'snapshot-fp-'));

  const elfSymbol = buildElfWithSymbol({ withSymbol: true });
  elfSymbolPath = join(tmpDir, 'with-symbol.so');
  await writeFile(elfSymbolPath, elfSymbol);

  const stripped = buildStrippedBlob(1024 * 4);
  strippedBlobPath = join(tmpDir, 'stripped.bin');
  await writeFile(strippedBlobPath, stripped);

  // A 1 MiB buffer of random-ish noise: never contains the magic.
  const noise = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 31 + 7) & 0xff;
  randomNoisePath = join(tmpDir, 'noise.bin');
  await writeFile(randomNoisePath, noise);

  // Kind variants
  elfWithKindFullPath = join(tmpDir, 'kind-full.so');
  await writeFile(elfWithKindFullPath, buildElfWithSymbol({ withSymbol: true, kind: 0 }));
  elfWithKindJitPath = join(tmpDir, 'kind-jit.so');
  await writeFile(elfWithKindJitPath, buildElfWithSymbol({ withSymbol: true, kind: 3 }));
  elfWithKindCorePath = join(tmpDir, 'kind-core.so');
  await writeFile(elfWithKindCorePath, buildElfWithSymbol({ withSymbol: true, kind: 4 }));
  // Unknown kind (e.g. 99)
  elfWithKindZeroPath = join(tmpDir, 'kind-unknown.so');
  await writeFile(elfWithKindZeroPath, buildElfWithSymbol({ withSymbol: true, kind: 99 }));

  // Arch variants
  elfWithArm32Path = join(tmpDir, 'arch-arm32.so');
  await writeFile(
    elfWithArm32Path,
    buildElfWithSymbol({ withSymbol: true, features: 'product no-fp arm' }),
  );
  elfWithX64Path = join(tmpDir, 'arch-x64.so');
  await writeFile(
    elfWithX64Path,
    buildElfWithSymbol({ withSymbol: true, features: 'product no-fp x64' }),
  );
  elfWithIa32Path = join(tmpDir, 'arch-ia32.so');
  await writeFile(
    elfWithIa32Path,
    buildElfWithSymbol({ withSymbol: true, features: 'product no-fp ia32' }),
  );
  elfWithRiscvPath = join(tmpDir, 'arch-riscv.so');
  await writeFile(
    elfWithRiscvPath,
    buildElfWithSymbol({ withSymbol: true, features: 'product no-fp riscv64' }),
  );

  // isProduction false (no `product` token)
  elfNoProductPath = join(tmpDir, 'no-product.so');
  await writeFile(
    elfNoProductPath,
    buildElfWithSymbol({ withSymbol: true, features: 'debug no-fp arm64' }),
  );

  // Empty file — exists but smaller than ELF header / scan budget = bail
  oversizePath = join(tmpDir, 'empty.bin');
  await writeFile(oversizePath, Buffer.alloc(0));

  // Byte-scan boundary case: magic straddles the 1 MiB chunk boundary.
  const cross = Buffer.alloc(1024 * 1024 + 256, 0xab);
  const snap = makeSnapshotBlob({ hashHex: DEFAULT_HASH_HEX });
  snap.copy(cross, 1024 * 1024 - 2); // magic spans 1MiB - 2 .. 1MiB + 2
  elfBoundaryScanPath = join(tmpDir, 'boundary.bin');
  await writeFile(elfBoundaryScanPath, cross);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('SnapshotFingerprint.parseHeader', () => {
  it('resolves via .dynsym when the symbol is present', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfSymbolPath);
    expect(out.source).toBe('symbol');
    expect(out.magic).toBe(DART_SNAPSHOT_MAGIC);
    expect(out.kind).toBe('full-aot');
    expect(out.hash).toBe(DEFAULT_HASH_HEX);
    expect(out.features).toContain('arm64');
    expect(out.targetArch).toBe('arm64');
    expect(out.isProduction).toBe(true);
  });

  it('falls back to byte-scan when no ELF symbol is present', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(strippedBlobPath);
    expect(out.source).toBe('byte-scan');
    expect(out.magic).toBe(DART_SNAPSHOT_MAGIC);
    expect(out.hash).toBe(DEFAULT_HASH_HEX);
    expect(out.fileOffset).toBe(1024 * 4);
  });

  it('returns unknown:true (no throw) on a non-Dart binary', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(randomNoisePath);
    expect(out.kind).toBe('unknown');
    expect(out.source).toBe('byte-scan');
    expect(out.hash).toBe('');
    expect(out.features).toEqual([]);
    expect(out.targetArch).toBe('unknown');
    expect(out.isProduction).toBe(false);
    expect(out.fileOffset).toBe(-1);
  });

  it('decodes kind=full correctly', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfWithKindFullPath);
    expect(out.kind).toBe('full');
  });

  it('decodes kind=full-jit correctly', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfWithKindJitPath);
    expect(out.kind).toBe('full-jit');
  });

  it('decodes kind=full-core correctly', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfWithKindCorePath);
    expect(out.kind).toBe('full-core');
  });

  it('returns kind=unknown for unknown numeric kinds', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfWithKindZeroPath);
    expect(out.kind).toBe('unknown');
  });

  it('decodes targetArch=arm32 from features', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfWithArm32Path);
    expect(out.targetArch).toBe('arm32');
  });

  it('decodes targetArch=x64 from features', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfWithX64Path);
    expect(out.targetArch).toBe('x64');
  });

  it('decodes targetArch=ia32 from features', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfWithIa32Path);
    expect(out.targetArch).toBe('ia32');
  });

  it('decodes targetArch=riscv64 from features', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfWithRiscvPath);
    expect(out.targetArch).toBe('riscv64');
  });

  it('sets isProduction=false when the `product` token is absent', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfNoProductPath);
    expect(out.isProduction).toBe(false);
    expect(out.features).toContain('debug');
  });

  it('throws VALIDATION for empty filePath', async () => {
    const fp = new SnapshotFingerprint();
    await expect(fp.parseHeader('')).rejects.toBeInstanceOf(ToolError);
    await expect(fp.parseHeader('')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('throws VALIDATION for negative maxScanBytes', async () => {
    const fp = new SnapshotFingerprint();
    await expect(fp.parseHeader(elfSymbolPath, { maxScanBytes: -1 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('throws NOT_FOUND for missing files', async () => {
    const fp = new SnapshotFingerprint();
    await expect(fp.parseHeader(join(tmpDir, 'no-such-file.bin'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('handles empty files gracefully (unknown payload, no throw)', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(oversizePath);
    expect(out.kind).toBe('unknown');
  });

  it('finds magic that straddles the byte-scan chunk boundary', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(elfBoundaryScanPath);
    expect(out.source).toBe('byte-scan');
    expect(out.magic).toBe(DART_SNAPSHOT_MAGIC);
    expect(out.fileOffset).toBe(1024 * 1024 - 2);
  });

  it('respects maxScanBytes=0 (returns unknown without scanning)', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.parseHeader(strippedBlobPath, { maxScanBytes: 0 });
    expect(out.kind).toBe('unknown');
    expect(out.fileOffset).toBe(-1);
  });

  it('caps the scan budget when maxScanBytes is set below the magic offset', async () => {
    const fp = new SnapshotFingerprint();
    // Snapshot blob is at offset 4096 in strippedBlobPath; cap at 100 → no hit.
    const out = await fp.parseHeader(strippedBlobPath, { maxScanBytes: 100 });
    expect(out.kind).toBe('unknown');
  });

  it('throws PERMISSION when file size exceeds the configured ceiling', async () => {
    // Mock constants for this single test so we do not need a real 1 GiB file.
    vi.resetModules();
    vi.doMock('@src/constants', async () => {
      const real = await vi.importActual<typeof import('@src/constants')>('@src/constants');
      return {
        ...real,
        DART_SNAPSHOT_MAX_FILE_BYTES: 16,
        DART_SNAPSHOT_HEADER_SCAN_MAX_BYTES: 4096,
      };
    });
    const { SnapshotFingerprint: SF } = await import('@modules/dart-inspector/SnapshotFingerprint');
    const fp = new SF();
    await expect(fp.parseHeader(strippedBlobPath)).rejects.toMatchObject({
      code: 'PERMISSION',
    });
    vi.doUnmock('@src/constants');
    vi.resetModules();
  });
});

describe('SnapshotFingerprint.fingerprint', () => {
  it('returns full version info when the hash is in the built-in table', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.fingerprint(elfSymbolPath);
    expect(out.unknown).toBe(false);
    expect(out.flutterVersion).toBe('3.0.0');
    expect(out.dartSdkRev).toBe('2.17.0');
    expect(out.engineCommit).toBeDefined();
  });

  it('returns unknown:true with the raw header when the hash is not in any table', async () => {
    const fp = new SnapshotFingerprint();
    const customHash = 'ff'.repeat(32);
    const elfPath = join(tmpDir, 'unknown-hash.so');
    await writeFile(elfPath, buildElfWithSymbol({ withSymbol: true, hashHex: customHash }));
    const out = await fp.fingerprint(elfPath);
    expect(out.unknown).toBe(true);
    expect(out.hash).toBe(customHash);
    expect(out.flutterVersion).toBeUndefined();
    expect(out.engineCommit).toBeUndefined();
    expect(out.dartSdkRev).toBeUndefined();
  });

  it('omits features when includeFeatures=false', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.fingerprint(elfSymbolPath, { includeFeatures: false });
    expect(out.features).toEqual([]);
  });

  it('emits features when includeFeatures=true (default)', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.fingerprint(elfSymbolPath);
    expect(out.features.length).toBeGreaterThan(0);
  });

  it('returns unknown:true on a non-Dart binary (no throw)', async () => {
    const fp = new SnapshotFingerprint();
    const out = await fp.fingerprint(randomNoisePath);
    expect(out.unknown).toBe(true);
    expect(out.kind).toBe('unknown');
    expect(out.flutterVersion).toBeUndefined();
  });
});
