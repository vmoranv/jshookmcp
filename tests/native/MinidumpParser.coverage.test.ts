/**
 * Coverage tests for MinidumpParser.parseMinidump — exercises file-read errors,
 * the header signature check, the stream-directory loop, and best-effort
 * stream-skip via synthesized minidump buffers (readFileSync mocked).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync: (p: string) => mockReadFileSync(p),
}));

import { parseMinidump, resolveAddress, resolveAddressBatch } from '@native/MinidumpParser';

beforeEach(() => {
  mockReadFileSync.mockReset();
});

/** Build a 32-byte MINIDUMP_HEADER with the given streamCount + directory RVA. */
function header(streamCount: number, streamDirRva: number): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0x504d444d, 0); // 'MDMP' signature (bytes 0-3)
  b.writeUInt16LE(0xa793, 4); // versionLo (bytes 4-5)
  b.writeUInt16LE(0x0000, 6); // versionHi (bytes 6-7)
  b.writeUInt32LE(streamCount, 8); // bytes 8-11
  b.writeUInt32LE(streamDirRva, 12); // bytes 12-15
  // checksum(16) + timestamp(20) + flags(24, 8 bytes) stay zero
  return b;
}

/** One stream-directory entry: streamType(4) + size(4) + locationRva(4) = 12 bytes. */
function dirEntry(streamType: number, size: number, locationRva: number): Buffer {
  const b = Buffer.alloc(12);
  b.writeUInt32LE(streamType, 0);
  b.writeUInt32LE(size, 4);
  b.writeUInt32LE(locationRva, 8);
  return b;
}

describe('parseMinidump — file read + header validation', () => {
  it('returns a structured error when the file cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const r = parseMinidump('/nope.dmp');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Cannot read file/);
    expect(r.filePath).toBe('/nope.dmp');
  });

  it('rejects a buffer with the wrong signature', () => {
    const bad = Buffer.alloc(32);
    bad.writeUInt32LE(0xdeadbeef, 0);
    mockReadFileSync.mockReturnValue(bad);
    const r = parseMinidump('/bad.dmp');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/bad signature/);
  });

  it('parses a valid header with zero streams (empty summary)', () => {
    // Header points stream dir at offset 32 (right after header); 0 streams.
    mockReadFileSync.mockReturnValue(header(0, 32));
    const r = parseMinidump('/empty.dmp');
    expect(r.success).toBe(true);
    expect(r.streamCount).toBe(0);
    expect(r.streams).toEqual([]);
    expect(r.modules).toEqual([]);
    expect(r.threads).toEqual([]);
    expect(r.memoryRanges).toEqual([]);
    expect(r.hasMemory64).toBe(false);
    expect(r.fileSize).toBe(32);
  });

  it('catches a truncated header and returns the thrown error', () => {
    mockReadFileSync.mockReturnValue(Buffer.from([0x4d, 0x44, 0x4d, 0x50])); // sig OK, rest missing
    const r = parseMinidump('/trunc.dmp');
    // readU16 past end → throws → caught → success=false with message
    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('rejects a stream directory RVA past the end of the file', () => {
    mockReadFileSync.mockReturnValue(header(1, 0xfffffff0));
    const r = parseMinidump('/bad-dir.dmp');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/out of bounds/);
  });

  it('skips a truncated stream without fabricating entries', () => {
    // ThreadListStream claims 2 threads but the stream holds only the count.
    const dirOffset = 32;
    const streamOffset = dirOffset + 12;
    const stream = Buffer.alloc(4);
    stream.writeUInt32LE(2, 0);

    const buf = Buffer.concat([header(1, dirOffset), dirEntry(3, 48, streamOffset), stream]);
    mockReadFileSync.mockReturnValue(buf);

    const r = parseMinidump('/trunc-stream.dmp');
    expect(r.success).toBe(true);
    expect(r.threads).toEqual([]);
  });
});

describe('parseMinidump — stream directory loop', () => {
  it('reads the stream directory entries with their type names', () => {
    const buf = Buffer.concat([
      header(2, 32),
      dirEntry(7, 0, 9999), // SystemInfoStream — invalid RVA → parseStream throws → skipped
      dirEntry(99, 0, 9999), // Unknown stream type
    ]);
    mockReadFileSync.mockReturnValue(buf);

    const r = parseMinidump('/streams.dmp');
    expect(r.success).toBe(true);
    expect(r.streamCount).toBe(2);
    expect(r.streams).toHaveLength(2);
    expect(r.streams[0]?.streamName).toBe('SystemInfoStream');
    expect(r.streams[1]?.streamName).toBe('Unknown(99)');
    // parseStream failures are best-effort (caught), so overall success stays true
  });

  it('parses a SystemInfoStream when the location is valid', () => {
    // Minimal SystemInfo layout per MINIDUMP_SYSTEM_INFO:
    //   processorArch(u16) + level(u16) + revision(u16) + numCpus(u8) +
    //   productType(u8) + major(u32) + minor(u32) + build(u32) + platformId(u32)
    //   + csdVersionRva(u32) + csdVersion (UTF-16LE string at csd offset)
    const sysInfo = Buffer.alloc(56);
    sysInfo.writeUInt16LE(9, 0); // x64
    sysInfo.writeUInt16LE(15, 2); // level
    sysInfo.writeUInt16LE(0x100, 4); // revision
    sysInfo.writeUInt8(4, 6); // 4 CPUs
    sysInfo.writeUInt8(1, 7); // productType
    sysInfo.writeUInt32LE(10, 8); // major
    sysInfo.writeUInt32LE(0, 12); // minor
    sysInfo.writeUInt32LE(19045, 16); // build
    sysInfo.writeUInt32LE(2, 20); // platformId (VER_PLATFORM_WIN32_NT)
    sysInfo.writeUInt32LE(0, 24); // csdVersionRva (0 = empty)

    const dirOffset = 32;
    const sysInfoOffset = dirOffset + 12; // right after one dir entry
    const buf = Buffer.concat([
      header(1, dirOffset),
      dirEntry(7, sysInfo.length, sysInfoOffset),
      sysInfo,
    ]);
    mockReadFileSync.mockReturnValue(buf);

    const r = parseMinidump('/sysinfo.dmp');
    expect(r.success).toBe(true);
    expect(r.systemInfo).toBeDefined();
    expect(r.systemInfo?.processorArchitecture).toBe('x64');
    expect(r.systemInfo?.numberOfProcessors).toBe(4);
    expect(r.systemInfo?.buildNumber).toBe(19045);
  });
});

describe('parseMinidump — thread list', () => {
  it('parses ThreadListStream entries', () => {
    // MINIDUMP_THREAD = 48 bytes: threadId(u32) suspendCount(u32) priorityClass(u32)
    // priority(u32) teb(u64) stackStart(u64) stackMemSize(u32) alignment(u32)
    // stackRva(u32) ctxRva(u32)
    const THREAD_SZ = 48;
    const threadData = Buffer.alloc(4 + THREAD_SZ * 2);
    threadData.writeUInt32LE(2, 0); // count
    // Thread 0 at offset 4
    const t0 = 4;
    threadData.writeUInt32LE(1234, t0);
    threadData.writeUInt32LE(0, t0 + 4);
    threadData.writeUInt32LE(32, t0 + 8);
    threadData.writeUInt32LE(0, t0 + 12);
    // teb at t0+16 (skip)
    threadData.writeBigUInt64LE(BigInt(0x7ffe0000), t0 + 24); // stackStart
    threadData.writeUInt32LE(4096, t0 + 32); // stackMemSize
    threadData.writeUInt32LE(0, t0 + 36); // alignment
    threadData.writeUInt32LE(0, t0 + 40); // stackRva
    threadData.writeUInt32LE(999, t0 + 44); // ctxRva
    // Thread 1 at offset 4 + 48 = 52
    const t1 = 52;
    threadData.writeUInt32LE(5678, t1);
    threadData.writeUInt32LE(1, t1 + 4);
    threadData.writeUInt32LE(16, t1 + 8);
    threadData.writeUInt32LE(2, t1 + 12);
    threadData.writeBigUInt64LE(BigInt(0x1000), t1 + 24);
    threadData.writeUInt32LE(8192, t1 + 32);
    threadData.writeUInt32LE(0, t1 + 36);
    threadData.writeUInt32LE(0, t1 + 40);
    threadData.writeUInt32LE(888, t1 + 44);
    const dirOffset = 32;
    const dataOffset = dirOffset + 12;
    const buf = Buffer.concat([
      header(1, dirOffset),
      dirEntry(3, threadData.length, dataOffset),
      threadData,
    ]);
    mockReadFileSync.mockReturnValue(buf);
    const r = parseMinidump('/threads.dmp');
    expect(r.threads).toHaveLength(2);
    expect(r.threads[0]?.threadId).toBe(1234);
    expect(r.threads[0]?.stackSize).toBe(4096);
    expect(r.threads[1]?.threadId).toBe(5678);
    expect(r.threads[1]?.priority).toBe(2);
  });
});

describe('parseMinidump — module list', () => {
  it('parses ModuleListStream with version info and a UTF-16 module name', () => {
    // MINIDUMP_MODULE = 108 bytes: base(u64) size(u32) checksum(u32)
    // timestamp(u32) nameRva(u32) + VS_FIXEDFILEINFO(52) + CvRecord(8) +
    // MiscRecord(8) + reserved0(u64) + reserved1(u64).
    const MOD_SZ = 108;
    const mod = Buffer.alloc(MOD_SZ);
    mod.writeBigUInt64LE(BigInt(0x7ff70000), 0);
    mod.writeUInt32LE(0x100000, 8);
    mod.writeUInt32LE(0, 12);
    mod.writeUInt32LE(0, 16);
    // nameRva is patched below once the absolute file offset is known.
    // VS_FIXEDFILEINFO: dwFileVersionMS @ 32, dwFileVersionLS @ 36
    mod.writeUInt32LE((10 << 16) | 0, 32);
    mod.writeUInt32LE((19041 << 16) | 5465, 36);

    const dirOffset = 32;
    const dataOffset = dirOffset + 12;
    const nameOffset = dataOffset + 4 + MOD_SZ;
    mod.writeUInt32LE(nameOffset, 20);

    const nameBytes = Buffer.from('test.dll', 'utf16le');
    const nameRec = Buffer.alloc(4 + nameBytes.length);
    nameRec.writeUInt32LE(nameBytes.length, 0);
    nameBytes.copy(nameRec, 4);

    const stream = Buffer.alloc(4 + MOD_SZ);
    stream.writeUInt32LE(1, 0); // module count
    mod.copy(stream, 4);

    const buf = Buffer.concat([
      header(1, dirOffset),
      dirEntry(4, stream.length + nameRec.length, dataOffset),
      stream,
      nameRec,
    ]);
    mockReadFileSync.mockReturnValue(buf);
    const r = parseMinidump('/mod.dmp');
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0]?.baseAddress).toBe('0x7ff70000');
    expect(r.modules[0]?.size).toBe(0x100000);
    expect(r.modules[0]?.name).toBe('test.dll');
    expect(r.modules[0]?.timestamp).toBe('n/a');
    expect(r.modules[0]?.version).toBe('10.0.19041.5465');
  });

  it('advances by the full 108-byte MINIDUMP_MODULE stride for every entry', () => {
    const MOD_SZ = 108;
    const stream = Buffer.alloc(4 + MOD_SZ * 2);
    stream.writeUInt32LE(2, 0);
    // Module 0
    stream.writeBigUInt64LE(BigInt(0x10000000), 4);
    stream.writeUInt32LE(0x1000, 12);
    stream.writeUInt32LE(0xffffffff, 24); // nameRva → out of range
    // Module 1 starts exactly one full struct later.
    stream.writeBigUInt64LE(BigInt(0x20000000), 4 + MOD_SZ);
    stream.writeUInt32LE(0x2000, 12 + MOD_SZ);
    stream.writeUInt32LE(0xffffffff, 24 + MOD_SZ);

    const dirOffset = 32;
    const dataOffset = dirOffset + 12;
    const buf = Buffer.concat([
      header(1, dirOffset),
      dirEntry(4, stream.length, dataOffset),
      stream,
    ]);
    mockReadFileSync.mockReturnValue(buf);
    const r = parseMinidump('/mods.dmp');
    expect(r.modules).toHaveLength(2);
    expect(r.modules[0]?.baseAddress).toBe('0x10000000');
    expect(r.modules[0]?.size).toBe(0x1000);
    expect(r.modules[1]?.baseAddress).toBe('0x20000000');
    expect(r.modules[1]?.size).toBe(0x2000);
    expect(r.modules[1]?.name).toBe('(unknown)');
  });
});

describe('parseMinidump — memory lists', () => {
  it('parses MemoryListStream (32-bit)', () => {
    // memoryCount(u32) + MINIDUMP_MEMORY_DESCRIPTOR{ start(u64) size(u32) rva(u32) }
    const mem = Buffer.alloc(4 + 16);
    mem.writeUInt32LE(1, 0);
    mem.writeBigUInt64LE(BigInt(0x10000000), 4);
    mem.writeUInt32LE(0x2000, 12);
    mem.writeUInt32LE(500, 16);
    const dirOffset = 32;
    const dataOffset = dirOffset + 12;
    const buf = Buffer.concat([header(1, dirOffset), dirEntry(5, mem.length, dataOffset), mem]);
    mockReadFileSync.mockReturnValue(buf);
    const r = parseMinidump('/mem.dmp');
    expect(r.memoryRanges).toHaveLength(1);
    expect(r.memoryRanges[0]?.startAddress).toBe('0x10000000');
    expect(r.memoryRanges[0]?.size).toBe(0x2000);
  });

  it('parses Memory64ListStream', () => {
    const m64 = Buffer.alloc(16 + 16);
    m64.writeBigUInt64LE(BigInt(1), 0);
    m64.writeBigUInt64LE(BigInt(0), 8);
    m64.writeBigUInt64LE(BigInt(0x20000000), 16);
    m64.writeBigUInt64LE(BigInt(0x4000), 24);
    const dirOffset = 32;
    const dataOffset = dirOffset + 12;
    const buf = Buffer.concat([header(1, dirOffset), dirEntry(9, m64.length, dataOffset), m64]);
    mockReadFileSync.mockReturnValue(buf);
    const r = parseMinidump('/mem64.dmp');
    expect(r.hasMemory64).toBe(true);
    expect(r.memoryRanges).toHaveLength(1);
    expect(r.memoryRanges[0]?.startAddress).toBe('0x20000000');
    expect(r.memoryRanges[0]?.size).toBe(0x4000);
  });

  it('accumulates Memory64List data offsets across sequential DataSizes', () => {
    // Two ranges. Per MSDN, range data is appended sequentially starting at
    // BaseRva: range 1's data starts at BaseRva + range 0's DataSize.
    const m64 = Buffer.alloc(16 + 32);
    m64.writeBigUInt64LE(BigInt(2), 0); // NumberOfMemoryRanges
    m64.writeBigUInt64LE(BigInt(0x1000), 8); // BaseRva
    m64.writeBigUInt64LE(BigInt(0x20000000), 16); // range 0 start
    m64.writeBigUInt64LE(BigInt(0x100), 24); // range 0 size
    m64.writeBigUInt64LE(BigInt(0x30000000), 32); // range 1 start
    m64.writeBigUInt64LE(BigInt(0x200), 40); // range 1 size
    const dirOffset = 32;
    const dataOffset = dirOffset + 12;
    const buf = Buffer.concat([header(1, dirOffset), dirEntry(9, m64.length, dataOffset), m64]);
    mockReadFileSync.mockReturnValue(buf);
    const r = parseMinidump('/mem64-2.dmp');
    expect(r.memoryRanges).toHaveLength(2);
    expect(r.memoryRanges[0]!.dataOffset).toBe(0x1000); // baseRva
    // 0x1000 + 0x100 — NOT baseRva + 1*16 (descriptor stride).
    expect(r.memoryRanges[1]!.dataOffset).toBe(0x1000 + 0x100);
  });
});

describe('parseMinidump — exception stream', () => {
  it('parses ExceptionStream with params', () => {
    const exc = Buffer.alloc(40 + 16);
    exc.writeUInt32LE(5678, 0);
    exc.writeUInt32LE(0, 4);
    exc.writeUInt32LE(0xc0000005, 8);
    exc.writeUInt32LE(0, 12);
    exc.writeBigUInt64LE(BigInt(0), 16);
    exc.writeBigUInt64LE(BigInt(0x7ffa1234), 24);
    exc.writeUInt32LE(2, 32);
    exc.writeUInt32LE(0, 36);
    exc.writeBigUInt64LE(BigInt(0xdead0001), 40);
    exc.writeBigUInt64LE(BigInt(0xdead0002), 48);
    const dirOffset = 32;
    const dataOffset = dirOffset + 12;
    const buf = Buffer.concat([header(1, dirOffset), dirEntry(6, exc.length, dataOffset), exc]);
    mockReadFileSync.mockReturnValue(buf);
    const r = parseMinidump('/exc.dmp');
    expect(r.exception).toBeDefined();
    expect(r.exception?.exceptionCode).toBe('0xc0000005');
    expect(r.exception?.threadId).toBe(5678);
    expect(r.exception?.numParams).toBe(2);
    expect(r.exception?.params).toHaveLength(2);
  });
});

describe('resolveAddress', () => {
  it('resolves to a module when address is within module range', () => {
    const r = resolveAddress(
      {
        success: true,
        filePath: '',
        fileSize: 0,
        streamCount: 0,
        streams: [],
        threads: [],
        memoryRanges: [],
        hasMemory64: false,
        modules: [
          {
            baseAddress: '0x1000',
            size: 100,
            name: 'test.dll',
            timestamp: 'n/a',
            checksum: 0,
            version: '1.0',
          },
        ],
      },
      '0x1050',
    );
    expect(r.found).toBe(true);
    expect(r.module?.name).toBe('test.dll');
    expect(r.offset).toBe(0x50);
  });

  it('resolves to a memory range when not in a module', () => {
    const r = resolveAddress(
      {
        success: true,
        filePath: '',
        fileSize: 0,
        streamCount: 0,
        streams: [],
        threads: [],
        modules: [],
        hasMemory64: false,
        memoryRanges: [{ startAddress: '0x2000', size: 500, dataOffset: 100 }],
      },
      '0x2100',
    );
    expect(r.found).toBe(true);
    expect(r.memoryRange?.startAddress).toBe('0x2000');
    expect(r.offset).toBe(0x100);
  });

  it('returns not found for an address outside all ranges', () => {
    const r = resolveAddress(
      {
        success: true,
        filePath: '',
        fileSize: 0,
        streamCount: 0,
        streams: [],
        threads: [],
        modules: [],
        memoryRanges: [],
        hasMemory64: false,
      },
      '0xffff',
    );
    expect(r.found).toBe(false);
  });

  it('handles non-hex input gracefully', () => {
    const r = resolveAddress(
      {
        success: true,
        filePath: '',
        fileSize: 0,
        streamCount: 0,
        streams: [],
        threads: [],
        modules: [],
        memoryRanges: [],
        hasMemory64: false,
      },
      'not-an-address',
    );
    expect(r.found).toBe(false);
    expect(r.address).toBe('not-an-address');
  });
});

describe('resolveAddressBatch', () => {
  it('resolves multiple addresses with queryIndex', () => {
    const r = resolveAddressBatch(
      {
        success: true,
        filePath: '',
        fileSize: 0,
        streamCount: 0,
        streams: [],
        threads: [],
        memoryRanges: [],
        hasMemory64: false,
        modules: [
          {
            baseAddress: '0x1000',
            size: 200,
            name: 'a.dll',
            timestamp: 'n/a',
            checksum: 0,
            version: '1',
          },
        ],
      },
      ['0x1050', '0x2000', '0x1080'],
    );
    expect(r).toHaveLength(3);
    expect(r[0]?.queryIndex).toBe(0);
    expect(r[0]?.found).toBe(true);
    expect(r[1]?.queryIndex).toBe(1);
    expect(r[1]?.found).toBe(false);
    expect(r[2]?.queryIndex).toBe(2);
    expect(r[2]?.found).toBe(true);
  });
});
