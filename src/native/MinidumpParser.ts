/**
 * Minidump Parser — pure-TypeScript reader for Windows Minidump (.dmp) files.
 *
 * Parses MINIDUMP_HEADER, stream directories, and extracts:
 *   - ModuleListStream  — loaded modules with base/size/name/timestamp
 *   - MemoryListStream  — memory ranges (pre-Memory64)
 *   - Memory64ListStream — 64-bit memory ranges (Windows 8+)
 *   - ThreadListStream  — threads with stack/context
 *   - SystemInfoStream  — OS/CPU info
 *   - ExceptionStream   — exception record + context
 *
 * Query by address: resolve which module or memory range contains a given VA.
 *
 * Pure TS, no native dependencies — works cross-platform.
 *
 * Based on MSDN MINIDUMP_HEADER / MINIDUMP_DIRECTORY / MINIDUMP_STREAM_TYPE
 * reference, and the mozilla/minidump_writer layout.
 *
 * @module MinidumpParser
 */

import { readFileSync } from 'node:fs';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MinidumpModule {
  baseAddress: string; // hex
  size: number;
  name: string;
  timestamp: string; // ISO 8601
  checksum: number;
  version: string; // "major.minor.build.revision"
}

export interface MinidumpMemoryRange {
  startAddress: string; // hex
  size: number;
  dataOffset: number; // file offset to raw bytes
}

export interface MinidumpThread {
  threadId: number;
  suspendCount: number;
  priorityClass: number;
  priority: number;
  stackAddress: string;
  stackSize: number;
  contextRva: number;
}

export interface MinidumpSystemInfo {
  processorArchitecture: string;
  processorLevel: number;
  processorRevision: number;
  numberOfProcessors: number;
  majorVersion: number;
  minorVersion: number;
  buildNumber: number;
  platformId: number;
  csdVersion: string;
}

export interface MinidumpException {
  exceptionCode: string;
  exceptionFlags: number;
  exceptionAddress: string;
  threadId: number;
  numParams: number;
  params: string[];
}

export interface MinidumpStreamDirectory {
  streamType: number;
  streamName: string;
  size: number;
  locationRva: number;
}

export interface MinidumpSummary {
  success: boolean;
  filePath: string;
  fileSize: number;
  streamCount: number;
  streams: MinidumpStreamDirectory[];
  modules: MinidumpModule[];
  threads: MinidumpThread[];
  memoryRanges: MinidumpMemoryRange[];
  systemInfo?: MinidumpSystemInfo;
  exception?: MinidumpException;
  hasMemory64: boolean;
  error?: string;
}

// ── Query interface ────────────────────────────────────────────────────────────

export interface AddressResolution {
  address: string;
  found: boolean;
  module?: MinidumpModule;
  memoryRange?: MinidumpMemoryRange;
  offset?: number;
}

// ── Stream type constants ──────────────────────────────────────────────────────

/** The stream types this parser decodes (keys align with STREAM_TYPES below). */
const STREAM_THREAD_LIST = 3;
const STREAM_MODULE_LIST = 4;
const STREAM_MEMORY_LIST = 5;
const STREAM_EXCEPTION = 6;
const STREAM_SYSTEM_INFO = 7;
const STREAM_MEMORY64_LIST = 9;

const STREAM_TYPES: Record<number, string> = {
  0: 'UnusedStream',
  1: 'ReservedStream0',
  2: 'ReservedStream1',
  3: 'ThreadListStream',
  4: 'ModuleListStream',
  5: 'MemoryListStream',
  6: 'ExceptionStream',
  7: 'SystemInfoStream',
  8: 'ThreadExListStream',
  9: 'Memory64ListStream',
  10: 'CommentStreamA',
  11: 'CommentStreamW',
  12: 'HandleDataStream',
  13: 'FunctionTableStream',
  14: 'UnloadedModuleListStream',
  15: 'MiscInfoStream',
  16: 'MemoryInfoListStream',
  17: 'ThreadInfoListStream',
  18: 'HandleOperationListStream',
  19: 'TokenStream',
  20: 'JavaScriptDataStream',
  21: 'SystemMemoryInfoStream',
  22: 'ProcessVmCountersStream',
};

const PROCESSOR_ARCH: Record<number, string> = {
  0: 'x86',
  5: 'ARM32',
  9: 'x64',
  12: 'ARM64',
  0xffff: 'Unknown',
};

// ── RAII file handle ───────────────────────────────────────────────────────────

class FileView {
  private buf: Buffer;
  private pos: number = 0;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  readU8(): number {
    return this.buf.readUInt8(this.pos++);
  }
  readU16(): number {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  readU32(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  readU64(): bigint {
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
  readBytes(n: number): Buffer {
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  readString(maxLen: number): string {
    const end = Math.min(this.pos + maxLen, this.buf.length);
    let i = this.pos;
    const buf = this.buf;
    while (i < end) {
      if (buf[i] === 0) break;
      i++;
    }
    const s = buf.subarray(this.pos, i).toString('utf8');
    this.pos += maxLen;
    return s;
  }
  /**
   * Read a MINIDUMP_STRING at a file RVA: u32 byte-length prefix followed by
   * raw UTF-16LE bytes (no NUL terminator). Does not move the read cursor.
   */
  readMinidumpString(rva: number): string {
    if (!this.valid(rva, 4)) return '';
    const byteLen = this.buf.readUInt32LE(rva);
    const start = rva + 4;
    const available = this.buf.length - start;
    const len = Math.min(byteLen, Math.max(0, available));
    if (len <= 0) return '';
    return this.buf.toString('utf16le', start, start + len);
  }
  seek(off: number): void {
    this.pos = off;
  }
  tell(): number {
    return this.pos;
  }
  getBuf(): Buffer {
    return this.buf;
  }
  valid(off: number, size = 1): boolean {
    return off >= 0 && off + size <= this.buf.length;
  }
  length(): number {
    return this.buf.length;
  }

  /** Read RVA as file offset (same in minidump since there's no section mapping) */
  readAt(rva: number): number {
    if (!this.valid(rva)) throw new Error(`RVA 0x${rva.toString(16)} out of bounds`);
    return rva;
  }
}

// ── Parser ─────────────────────────────────────────────────────────────────────

export function parseMinidump(filePath: string): MinidumpSummary {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch (err) {
    return {
      success: false,
      filePath,
      error: `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
      fileSize: 0,
      streamCount: 0,
      streams: [],
      modules: [],
      threads: [],
      memoryRanges: [],
      hasMemory64: false,
    };
  }

  const f = new FileView(data);
  const result: MinidumpSummary = {
    success: true,
    filePath,
    fileSize: data.length,
    streamCount: 0,
    streams: [],
    modules: [],
    threads: [],
    memoryRanges: [],
    hasMemory64: false,
  };

  try {
    // ── Header ──────────────────────────────────────────────────────────────
    const sig = f.readU32();
    if (sig !== 0x504d444d) {
      // 'MDMP'
      result.success = false;
      result.error = 'Not a valid minidump file (bad signature)';
      return result;
    }

    f.readU16(); // versionLo — stream directory metadata
    f.readU16(); // versionHi
    const streamCount = f.readU32();
    const streamDirRva = f.readU32();
    f.readU32(); // checksum — reserved for header digests
    f.readU32(); // timestamp
    f.readU64(); // flags

    result.streamCount = streamCount;

    // ── Stream directories ──────────────────────────────────────────────────
    f.seek(streamDirRva);

    const streamEntries: Array<{
      streamType: number;
      locationRva: number;
      size: number;
    }> = [];

    for (let i = 0; i < streamCount; i++) {
      const streamType = f.readU32();
      const size = f.readU32();
      const locationRva = f.readU32();
      streamEntries.push({ streamType, locationRva, size });
      result.streams.push({
        streamType,
        streamName: STREAM_TYPES[streamType] ?? `Unknown(${streamType})`,
        size,
        locationRva,
      });
    }

    // ── Parse each stream ───────────────────────────────────────────────────
    for (const entry of streamEntries) {
      try {
        parseStream(f, entry, result);
      } catch {
        /* best-effort */
      }
    }

    return result;
  } catch (err) {
    result.success = false;
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

function parseStream(
  f: FileView,
  entry: { streamType: number; locationRva: number; size: number },
  out: MinidumpSummary,
): void {
  switch (entry.streamType) {
    case STREAM_THREAD_LIST:
      parseThreadList(f, entry.locationRva, out);
      break;
    case STREAM_MODULE_LIST:
      parseModuleList(f, entry.locationRva, out);
      break;
    case STREAM_MEMORY_LIST:
      parseMemoryList(f, entry.locationRva, out);
      break;
    case STREAM_EXCEPTION:
      parseException(f, entry.locationRva, out);
      break;
    case STREAM_SYSTEM_INFO:
      parseSystemInfo(f, entry.locationRva, out);
      break;
    case STREAM_MEMORY64_LIST:
      parseMemory64List(f, entry.locationRva, out);
      out.hasMemory64 = true;
      break;
  }
}

// ── ThreadListStream ───────────────────────────────────────────────────────────

function parseThreadList(f: FileView, rva: number, out: MinidumpSummary): void {
  f.seek(rva);
  const count = f.readU32();
  for (let i = 0; i < count; i++) {
    const threadId = f.readU32();
    const suspendCount = f.readU32();
    const priorityClass = f.readU32();
    const priority = f.readU32();
    f.readU64(); // teb — not exposed
    const stackStart = f.readU64();
    const stackMemSize = f.readU32();
    f.readU32(); // alignment padding
    f.readU32(); // stackRva — captured as stackAddress above
    const ctxRva = f.readU32();
    out.threads.push({
      threadId,
      suspendCount,
      priorityClass,
      priority,
      stackAddress: `0x${stackStart.toString(16)}`,
      stackSize: stackMemSize,
      contextRva: ctxRva,
    });
  }
}

// ── ModuleListStream ───────────────────────────────────────────────────────────

function parseModuleList(f: FileView, rva: number, out: MinidumpSummary): void {
  f.seek(rva);
  const count = f.readU32();
  for (let i = 0; i < count; i++) {
    const base = f.readU64();
    const size = f.readU32();
    f.readU32(); // checksum
    const timestamp = f.readU32();
    const nameRva = f.readU32();

    // VS_FIXEDFILEINFO is 52 bytes (13 DWORDs). The file version is the two
    // DWORDs at offsets 8 (MS) and 12 (LS); skip dwSignature/dwStrucVersion
    // before them and the remaining product/flag DWORDs after them.
    const versionInfo = f.readBytes(52);
    const fileVersionMS = versionInfo.readUInt32LE(8);
    const fileVersionLS = versionInfo.readUInt32LE(12);
    const vMaj = (fileVersionMS >>> 16) & 0xffff;
    const vMin = fileVersionMS & 0xffff;
    const vBld = (fileVersionLS >>> 16) & 0xffff;
    const vRev = fileVersionLS & 0xffff;

    // CV record
    f.readU32(); // cvDataSize
    f.readU32(); // cvRva
    f.readU32(); // miscDataSize
    f.readU32(); // miscRva
    f.readU64(); // reserved0
    f.readU64(); // reserved1

    let modName = '(unknown)';
    if (f.valid(nameRva)) {
      modName = f.readMinidumpString(nameRva);
    }

    const ts = timestamp > 0 ? new Date(timestamp * 1000).toISOString() : 'n/a';

    out.modules.push({
      baseAddress: `0x${base.toString(16)}`,
      size,
      name: modName,
      timestamp: ts,
      checksum: 0,
      version: `${vMaj}.${vMin}.${vBld}.${vRev}`,
    });
  }
}

// ── MemoryListStream (32-bit, pre-Win8) ───────────────────────────────────────

function parseMemoryList(f: FileView, rva: number, out: MinidumpSummary): void {
  f.seek(rva);
  const count = f.readU32();
  for (let i = 0; i < count; i++) {
    // MINIDUMP_MEMORY_DESCRIPTOR: StartOfMemoryRange(u64) +
    // MINIDUMP_LOCATION_DESCRIPTOR { DataSize(u32), Rva(u32) } = 16 bytes.
    const start = f.readU64();
    const size = f.readU32();
    const memRva = f.readU32();
    out.memoryRanges.push({
      startAddress: `0x${start.toString(16)}`,
      size: Number(size),
      dataOffset: memRva,
    });
  }
}

// ── Memory64ListStream (64-bit, Win8+) ────────────────────────────────────────

function parseMemory64List(f: FileView, rva: number, out: MinidumpSummary): void {
  f.seek(rva);
  const count = f.readU64();
  const baseRva = f.readU64();

  // Per MSDN, every range's raw data is appended sequentially starting at
  // BaseRva: range i's data begins at baseRva + the cumulative DataSize of all
  // previous ranges (NOT baseRva + i * descriptor stride — that formula only
  // works by accident when every range has a 16-byte DataSize).
  let dataCursor = Number(baseRva);
  for (let i = 0; i < Number(count) && i < 10000; i++) {
    const start = f.readU64();
    const size = f.readU64();
    out.memoryRanges.push({
      startAddress: `0x${start.toString(16)}`,
      size: Number(size),
      dataOffset: dataCursor,
    });
    dataCursor += Number(size);
  }
}

// ── ExceptionStream ────────────────────────────────────────────────────────────

function parseException(f: FileView, rva: number, out: MinidumpSummary): void {
  f.seek(rva);
  const threadId = f.readU32();
  f.readU32(); // alignment
  const excCode = f.readU32();
  const excFlags = f.readU32();
  f.readU64(); // excRecord (struct ptr, not used)
  const excAddr = f.readU64();
  const numParams = f.readU32();
  f.readU32(); // alignment
  const params: string[] = [];
  for (let i = 0; i < numParams && i < 15; i++) {
    params.push(`0x${f.readU64().toString(16)}`);
  }

  out.exception = {
    exceptionCode: `0x${excCode.toString(16)}`,
    exceptionFlags: excFlags,
    exceptionAddress: `0x${excAddr.toString(16)}`,
    threadId,
    numParams,
    params,
  };
}

// ── SystemInfoStream ──────────────────────────────────────────────────────────

function parseSystemInfo(f: FileView, rva: number, out: MinidumpSummary): void {
  f.seek(rva);
  const procArch = f.readU16();
  const procLevel = f.readU16();
  const procRev = f.readU16();
  const numProcs = f.readU8();
  f.readU8(); // productType
  const major = f.readU32();
  const minor = f.readU32();
  const build = f.readU32();
  const platform = f.readU32();
  // CSDVersionRva + suiteMask + reserved2 + CPU vendor id
  // skip detailed parsing for simplicity
  out.systemInfo = {
    processorArchitecture: PROCESSOR_ARCH[procArch] ?? `Unknown(${procArch})`,
    processorLevel: procLevel,
    processorRevision: procRev,
    numberOfProcessors: numProcs,
    majorVersion: major,
    minorVersion: minor,
    buildNumber: build,
    platformId: platform,
    csdVersion: '',
  };
}

// ── Query helpers ──────────────────────────────────────────────────────────────

export function resolveAddress(summary: MinidumpSummary, addressHex: string): AddressResolution {
  let addr: bigint;
  try {
    addr = BigInt(addressHex.startsWith('0x') ? addressHex : `0x${addressHex}`);
  } catch {
    return { address: addressHex, found: false };
  }

  // Check modules first (for code addresses)
  for (const mod of summary.modules) {
    const base = BigInt(mod.baseAddress);
    const end = base + BigInt(mod.size);
    if (addr >= base && addr < end) {
      return {
        address: addressHex,
        found: true,
        module: mod,
        offset: Number(addr - base),
      };
    }
  }

  // Check memory ranges
  for (const range of summary.memoryRanges) {
    const start = BigInt(range.startAddress);
    const end = start + BigInt(range.size);
    if (addr >= start && addr < end) {
      return {
        address: addressHex,
        found: true,
        memoryRange: range,
        offset: Number(addr - start),
      };
    }
  }

  return { address: addressHex, found: false };
}

/**
 * Query how many of the addresses in a list can be resolved against
 * the dump (coverage metric — useful for forensic triage).
 */
export function resolveAddressBatch(
  summary: MinidumpSummary,
  addresses: string[],
): Array<AddressResolution & { queryIndex: number }> {
  return addresses.map((addr, i) => ({ ...resolveAddress(summary, addr), queryIndex: i }));
}
