/**
 * SnapshotFingerprint — parse the Dart isolate snapshot header from a
 * Flutter AOT shared library and identify the Dart/Flutter release.
 *
 * Read-only static analysis:
 *  - opens the file via `node:fs`, reads only the bytes it needs
 *  - never mutates, never executes, never spawns a subprocess, never
 *    hits the network
 *  - falls back gracefully to a structured "unknown" payload when the
 *    binary is not a Dart snapshot
 *
 * Header layout (Phrack #71, Aug 2024; cross-checked against the
 * open-source `darter` and `reFlutter` projects):
 *
 * ```
 *  +0x00  uint32   magic        = 0xf5f5dcdc  (little-endian)
 *  +0x04  uint32   kind         (0 full, 2 full-aot, 3 full-jit, 4 full-core)
 *  +0x08  char[32] snapshot_hash
 *  +0x28  char[*]  features     (NUL-terminated, space-separated)
 * ```
 *
 * The parser locates the header either by reading the ELF `.dynsym`
 * (preferred — O(1) lookup) or, when the library is stripped, by
 * scanning the first {@link DART_SNAPSHOT_HEADER_SCAN_MAX_BYTES} of the
 * file for the 4-byte magic.
 */

import { open, stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

import { DART_SNAPSHOT_HEADER_SCAN_MAX_BYTES, DART_SNAPSHOT_MAX_FILE_BYTES } from '@src/constants';
import { ToolError } from '@errors/ToolError';

import {
  DART_SNAPSHOT_MAGIC,
  type FingerprintOptions,
  type ParseOptions,
  type SnapshotArch,
  type SnapshotHeader,
  type SnapshotKind,
  type SnapshotSource,
  type VersionFingerprint,
} from './snapshot-types';
import { loadVersionTable } from './snapshot-version-table';

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]); // 0x7f 'E' 'L' 'F'
const HEADER_HASH_OFFSET = 0x08;
const HEADER_HASH_LENGTH = 32;
const HEADER_FEATURES_OFFSET = 0x28;
const HEADER_PROBE_BYTES = 4096; // enough for magic + hash + features

const SNAPSHOT_SYMBOL = '_kDartIsolateSnapshotData';
const ALT_SNAPSHOT_SYMBOL = 'kDartIsolateSnapshotData';

const ARCH_TOKENS: Record<string, SnapshotArch> = {
  arm64: 'arm64',
  arm: 'arm32',
  arm32: 'arm32',
  x64: 'x64',
  ia32: 'ia32',
  riscv64: 'riscv64',
};

const KIND_BY_VALUE: Record<number, SnapshotKind> = {
  0: 'full',
  2: 'full-aot',
  3: 'full-jit',
  4: 'full-core',
};

interface ElfShdr {
  type: number;
  offset: number;
  size: number;
  link: number;
  entsize: number;
  name: number;
}

interface ResolvedSymbol {
  fileOffset: number;
}

/**
 * Magic-as-little-endian bytes. Stored as a Buffer for fast `indexOf`
 * searches during the byte-scan fallback path.
 */
const MAGIC_BYTES = Buffer.alloc(4);
MAGIC_BYTES.writeUInt32LE(DART_SNAPSHOT_MAGIC, 0);

export class SnapshotFingerprint {
  /**
   * Parse the snapshot header from a file. See {@link SnapshotHeader}
   * for the result shape and {@link ParseOptions} for tunables.
   *
   * Validation order: VALIDATION → NOT_FOUND → PERMISSION → parse.
   */
  async parseHeader(filePath: string, opts: ParseOptions = {}): Promise<SnapshotHeader> {
    if (!filePath || filePath.length === 0) {
      throw new ToolError('VALIDATION', 'filePath must be a non-empty string');
    }
    if (opts.maxScanBytes !== undefined && opts.maxScanBytes < 0) {
      throw new ToolError('VALIDATION', `maxScanBytes must be >= 0 (got ${opts.maxScanBytes})`);
    }

    let fileSize: number;
    try {
      const st = await stat(filePath);
      fileSize = st.size;
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `File not found: ${filePath}`, {
        details: { filePath },
        cause: cause as Error,
      });
    }

    if (fileSize > DART_SNAPSHOT_MAX_FILE_BYTES) {
      throw new ToolError(
        'PERMISSION',
        `File ${filePath} exceeds DART_SNAPSHOT_MAX_FILE_BYTES (${fileSize} > ${DART_SNAPSHOT_MAX_FILE_BYTES})`,
        { details: { filePath, fileSize, limit: DART_SNAPSHOT_MAX_FILE_BYTES } },
      );
    }

    const scanCap = Math.min(opts.maxScanBytes ?? DART_SNAPSHOT_HEADER_SCAN_MAX_BYTES, fileSize);

    const fh = await open(filePath, 'r');
    try {
      // 1. ELF? If not, skip straight to byte scan.
      const isElf = await checkElf(fh, fileSize);

      // 2. Try symbol resolution when ELF.
      if (isElf) {
        const symbol = await resolveSnapshotSymbol(fh, fileSize);
        if (symbol) {
          const decoded = await readHeader(fh, symbol.fileOffset, fileSize);
          if (decoded) return finalizeHeader(decoded, symbol.fileOffset, 'symbol');
        }
      }

      // 3. Byte scan fallback.
      const scanned = await byteScan(fh, scanCap);
      if (scanned !== null) {
        const decoded = await readHeader(fh, scanned, fileSize);
        if (decoded) return finalizeHeader(decoded, scanned, 'byte-scan');
      }

      // 4. Nothing found — return structured `unknown`.
      return makeUnknownHeader();
    } finally {
      await fh.close();
    }
  }

  /**
   * Parse the header then look up the snapshot hash in the version
   * table (built-in + optional user JSON). Never throws when the
   * binary is not a Dart snapshot — returns `unknown: true` instead.
   */
  async fingerprint(filePath: string, opts: FingerprintOptions = {}): Promise<VersionFingerprint> {
    const header = await this.parseHeader(filePath, opts);
    const table = await loadVersionTable(opts.customTablePath);
    const entry = table.get(header.hash);

    const includeFeatures = opts.includeFeatures ?? true;
    const features = includeFeatures ? header.features : [];

    const fp: VersionFingerprint = {
      ...header,
      features,
      unknown: !entry,
    };
    if (entry) {
      fp.flutterVersion = entry.flutterVersion;
      if (entry.engineCommit !== undefined) fp.engineCommit = entry.engineCommit;
      if (entry.dartSdkRev !== undefined) fp.dartSdkRev = entry.dartSdkRev;
      if (entry.releaseDate !== undefined) fp.releaseDate = entry.releaseDate;
    }
    return fp;
  }
}

/* ── ELF helpers ─────────────────────────────────────────────────── */

async function checkElf(
  fh: import('node:fs/promises').FileHandle,
  fileSize: number,
): Promise<boolean> {
  if (fileSize < 4) return false;
  const buf = Buffer.alloc(4);
  await fh.read(buf, 0, 4, 0);
  return buf.equals(ELF_MAGIC);
}

async function resolveSnapshotSymbol(
  fh: import('node:fs/promises').FileHandle,
  fileSize: number,
): Promise<ResolvedSymbol | null> {
  // Read the ELF header. We only need enough for class (32/64), endianness,
  // section header offset (e_shoff), section entry size (e_shentsize),
  // section count (e_shnum), and string-table index (e_shstrndx).
  if (fileSize < 64) return null;
  const ehdr = Buffer.alloc(64);
  await fh.read(ehdr, 0, 64, 0);

  const ei_class = ehdr.readUInt8(4); // 1 = ELF32, 2 = ELF64
  const ei_data = ehdr.readUInt8(5); // 1 = little-endian, 2 = big-endian
  if (ei_data !== 1) return null; // We only support little-endian.
  if (ei_class !== 1 && ei_class !== 2) return null;

  let e_shoff: number;
  let e_shentsize: number;
  let e_shnum: number;
  if (ei_class === 2) {
    // ELF64: e_shoff @ 0x28 (8 bytes), e_shentsize @ 0x3a (2), e_shnum @ 0x3c (2)
    const shoff = ehdr.readBigUInt64LE(0x28);
    if (shoff > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    e_shoff = Number(shoff);
    e_shentsize = ehdr.readUInt16LE(0x3a);
    e_shnum = ehdr.readUInt16LE(0x3c);
  } else {
    // ELF32: e_shoff @ 0x20 (4), e_shentsize @ 0x2e (2), e_shnum @ 0x30 (2)
    e_shoff = ehdr.readUInt32LE(0x20);
    e_shentsize = ehdr.readUInt16LE(0x2e);
    e_shnum = ehdr.readUInt16LE(0x30);
  }

  if (e_shoff === 0 || e_shnum === 0 || e_shentsize === 0) return null;
  const shTableSize = e_shentsize * e_shnum;
  if (e_shoff + shTableSize > fileSize) return null;

  const shTable = Buffer.alloc(shTableSize);
  await fh.read(shTable, 0, shTableSize, e_shoff);

  // Walk sections, capture .dynsym by sh_type.
  // sh_type 11 = SHT_DYNSYM, sh_type 3 = SHT_STRTAB
  let dynsym: ElfShdr | undefined;
  for (let i = 0; i < e_shnum; i++) {
    const shdr = readShdr(shTable, i, e_shentsize, ei_class === 2);
    if (!shdr) continue;
    if (shdr.type === 11) {
      dynsym = shdr;
      break;
    }
  }
  if (!dynsym) return null;
  // .dynsym.sh_link points at the section index of the string table.
  // Look it up directly in the section header table (not in the filtered
  // dynstrCandidates list, whose indices do not match section indices).
  const dynstr = readShdr(shTable, dynsym.link, e_shentsize, ei_class === 2);
  if (!dynstr || dynstr.type !== 3) return null;
  if (dynstr.offset + dynstr.size > fileSize) return null;

  const strs = Buffer.alloc(dynstr.size);
  await fh.read(strs, 0, dynstr.size, dynstr.offset);

  const symEntSize = dynsym.entsize > 0 ? dynsym.entsize : ei_class === 2 ? 24 : 16;
  const symCount = Math.floor(dynsym.size / symEntSize);
  if (symCount === 0) return null;
  // Reject malformed/hostile ELFs where dynsym.size would push the read
  // past EOF or trigger an oversized allocation.
  if (dynsym.offset + dynsym.size > fileSize) return null;
  const symBuf = Buffer.alloc(dynsym.size);
  await fh.read(symBuf, 0, dynsym.size, dynsym.offset);

  // Walk symbols. For each, read st_name (always at offset 0) and look it up
  // in the string table. ELF64 / ELF32 differ in field order so we branch.
  for (let i = 0; i < symCount; i++) {
    const base = i * symEntSize;
    const stName = symBuf.readUInt32LE(base);
    if (stName === 0 || stName >= strs.length) continue;
    const name = readCString(strs, stName);
    if (name !== SNAPSHOT_SYMBOL && name !== ALT_SNAPSHOT_SYMBOL) continue;
    // st_value layout:
    //   ELF64: st_name(4) st_info(1) st_other(1) st_shndx(2) st_value(8) st_size(8)
    //   ELF32: st_name(4) st_value(4) st_size(4) st_info(1) st_other(1) st_shndx(2)
    let stValue: number;
    if (ei_class === 2) {
      const v = symBuf.readBigUInt64LE(base + 8);
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) continue;
      stValue = Number(v);
    } else {
      stValue = symBuf.readUInt32LE(base + 4);
    }
    // st_value is a VMA; for our purposes we translate via the section the
    // symbol belongs to (st_shndx). Simpler: walk sections again and find one
    // whose [addr, addr+size) contains stValue, then translate.
    let stShndx: number;
    if (ei_class === 2) {
      stShndx = symBuf.readUInt16LE(base + 6);
    } else {
      stShndx = symBuf.readUInt16LE(base + 14);
    }
    const targetSection = readShdr(shTable, stShndx, e_shentsize, ei_class === 2);
    if (!targetSection) continue;
    // We re-read addr (sh_addr) which was skipped in readShdr — recompute here.
    const sh_addr = readShAddr(shTable, stShndx, e_shentsize, ei_class === 2);
    if (sh_addr === undefined) continue;
    const fileOffset = stValue - sh_addr + targetSection.offset;
    if (fileOffset < 0 || fileOffset >= fileSize) continue;
    return { fileOffset };
  }
  return null;
}

function readShdr(
  table: Buffer,
  index: number,
  entSize: number,
  is64: boolean,
): ElfShdr | undefined {
  const base = index * entSize;
  if (base < 0 || base + entSize > table.length) return undefined;
  if (is64) {
    // sh_name(4) sh_type(4) sh_flags(8) sh_addr(8) sh_offset(8) sh_size(8) sh_link(4) sh_info(4) sh_addralign(8) sh_entsize(8)
    const offsetBig = table.readBigUInt64LE(base + 0x18);
    const sizeBig = table.readBigUInt64LE(base + 0x20);
    const entSizeBig = table.readBigUInt64LE(base + 0x38);
    if (
      offsetBig > BigInt(Number.MAX_SAFE_INTEGER) ||
      sizeBig > BigInt(Number.MAX_SAFE_INTEGER) ||
      entSizeBig > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return undefined;
    }
    return {
      name: table.readUInt32LE(base + 0x00),
      type: table.readUInt32LE(base + 0x04),
      offset: Number(offsetBig),
      size: Number(sizeBig),
      link: table.readUInt32LE(base + 0x28),
      entsize: Number(entSizeBig),
    };
  }
  // ELF32: sh_name(4) sh_type(4) sh_flags(4) sh_addr(4) sh_offset(4) sh_size(4) sh_link(4) sh_info(4) sh_addralign(4) sh_entsize(4)
  return {
    name: table.readUInt32LE(base + 0x00),
    type: table.readUInt32LE(base + 0x04),
    offset: table.readUInt32LE(base + 0x10),
    size: table.readUInt32LE(base + 0x14),
    link: table.readUInt32LE(base + 0x18),
    entsize: table.readUInt32LE(base + 0x24),
  };
}

function readShAddr(
  table: Buffer,
  index: number,
  entSize: number,
  is64: boolean,
): number | undefined {
  const base = index * entSize;
  if (base < 0 || base + entSize > table.length) return undefined;
  if (is64) {
    const addr = table.readBigUInt64LE(base + 0x10);
    if (addr > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return Number(addr);
  }
  return table.readUInt32LE(base + 0x0c);
}

function readCString(buf: Buffer, offset: number): string {
  const end = buf.indexOf(0, offset);
  if (end < 0) return buf.toString('utf8', offset);
  return buf.toString('utf8', offset, end);
}

/* ── Byte scan ───────────────────────────────────────────────────── */

async function byteScan(
  fh: import('node:fs/promises').FileHandle,
  budget: number,
): Promise<number | null> {
  if (budget < 4) return null;
  const chunkSize = 1024 * 1024; // 1 MiB chunks
  const overlap = 3; // magic is 4 bytes
  let position = 0;
  let pending = Buffer.alloc(0);
  while (position < budget) {
    const remaining = budget - position;
    const want = Math.min(chunkSize, remaining);
    const buf = Buffer.alloc(want);
    const { bytesRead } = await fh.read(buf, 0, want, position);
    if (bytesRead === 0) break;
    const combined =
      pending.length === 0
        ? buf.subarray(0, bytesRead)
        : Buffer.concat([pending, buf.subarray(0, bytesRead)]);
    const idx = combined.indexOf(MAGIC_BYTES);
    if (idx >= 0) {
      return position - pending.length + idx;
    }
    position += bytesRead;
    if (bytesRead < want) break;
    pending = combined.subarray(combined.length - overlap);
  }
  return null;
}

/* ── Header decode ───────────────────────────────────────────────── */

interface DecodedHeader {
  magic: number;
  kind: SnapshotKind;
  hash: string;
  features: string[];
  targetArch: SnapshotArch;
  isProduction: boolean;
}

async function readHeader(
  fh: import('node:fs/promises').FileHandle,
  fileOffset: number,
  fileSize: number,
): Promise<DecodedHeader | null> {
  if (fileOffset + 8 > fileSize) return null;
  const probeLen = Math.min(HEADER_PROBE_BYTES, fileSize - fileOffset);
  const buf = Buffer.alloc(probeLen);
  await fh.read(buf, 0, probeLen, fileOffset);

  const magic = buf.readUInt32LE(0);
  if (magic !== DART_SNAPSHOT_MAGIC) return null;
  const kindNum = buf.readUInt32LE(4);
  const kind = KIND_BY_VALUE[kindNum] ?? 'unknown';

  if (probeLen < HEADER_FEATURES_OFFSET) {
    return {
      magic,
      kind,
      hash: '',
      features: [],
      targetArch: 'unknown',
      isProduction: false,
    };
  }
  const hash = buf
    .subarray(HEADER_HASH_OFFSET, HEADER_HASH_OFFSET + HEADER_HASH_LENGTH)
    .toString('hex');

  const features = decodeFeatures(buf, HEADER_FEATURES_OFFSET);
  const targetArch = pickArch(features);
  const isProduction = features.includes('product');

  return { magic, kind, hash, features, targetArch, isProduction };
}

function decodeFeatures(buf: Buffer, start: number): string[] {
  const end = buf.indexOf(0, start);
  const stop = end < 0 ? buf.length : end;
  const raw = buf.toString('utf8', start, stop);
  return raw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function pickArch(features: readonly string[]): SnapshotArch {
  for (const token of features) {
    const norm = token.toLowerCase();
    const hit = ARCH_TOKENS[norm];
    if (hit) return hit;
  }
  return 'unknown';
}

function finalizeHeader(
  decoded: DecodedHeader,
  fileOffset: number,
  source: SnapshotSource,
): SnapshotHeader {
  return {
    magic: decoded.magic,
    kind: decoded.kind,
    hash: decoded.hash,
    features: decoded.features,
    targetArch: decoded.targetArch,
    isProduction: decoded.isProduction,
    fileOffset,
    source,
  };
}

function makeUnknownHeader(): SnapshotHeader {
  return {
    magic: 0,
    kind: 'unknown',
    hash: '',
    features: [],
    targetArch: 'unknown',
    isProduction: false,
    fileOffset: -1,
    source: 'byte-scan',
  };
}
