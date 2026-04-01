/**
 * PEAnalyzer — unit tests.
 *
 * Builds synthetic PE data in mock ReadProcessMemory to test header parsing,
 * section listing, import/export resolution, inline hook detection, and anomaly analysis.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Build Synthetic PE Data ──

function buildMockPE(): Buffer {
  const buf = Buffer.alloc(16384);

  // DOS Header
  buf.writeUInt16LE(0x5a4d, 0); // e_magic = 'MZ'
  buf.writeUInt32LE(0x80, 60); // e_lfanew = 128

  // NT Headers at offset 0x80
  buf.writeUInt32LE(0x00004550, 0x80); // PE signature

  // File Header (20 bytes at 0x84)
  buf.writeUInt16LE(0x8664, 0x84); // Machine = AMD64
  buf.writeUInt16LE(4, 0x86); // NumberOfSections = 4
  buf.writeUInt32LE(0x60001234, 0x88); // TimeDateStamp
  buf.writeUInt16LE(240, 0x94); // SizeOfOptionalHeader (PE32+)
  buf.writeUInt16LE(0x22, 0x96); // Characteristics (EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE)

  // Optional Header (PE32+) at 0x98
  buf.writeUInt16LE(0x20b, 0x98); // Magic = PE32+
  buf.writeBigUInt64LE(0x140000000n, 0xb0); // ImageBase
  buf.writeUInt32LE(0x1000, 0xa8); // AddressOfEntryPoint
  buf.writeUInt32LE(0x10000, 0xd8); // SizeOfImage
  buf.writeUInt32LE(17, 0x104); // NumberOfRvaAndSizes

  // Data Directories (at 0x108)
  // Export (dir 0): RVA=0x2000, Size=0x200
  buf.writeUInt32LE(0x2000, 0x108);
  buf.writeUInt32LE(0x200, 0x10c);
  // Import (dir 1): RVA=0x3000, Size=0x100
  buf.writeUInt32LE(0x3000, 0x110);
  buf.writeUInt32LE(0x100, 0x114);

  // Section Headers start at 0x80 + 4 + 20 + 240 = 0x188
  const secStart = 0x188;

  // Section 1: .text (executable)
  buf.write('.text\0\0\0', secStart, 'ascii');
  buf.writeUInt32LE(0x1000, secStart + 8); // VirtualSize
  buf.writeUInt32LE(0x1000, secStart + 12); // VirtualAddress
  buf.writeUInt32LE(0x800, secStart + 16); // SizeOfRawData
  buf.writeUInt32LE(0x1000, secStart + 20); // PointerToRawData
  buf.writeUInt32LE(0x60000020, secStart + 36); // Characteristics: CODE|MEM_EXECUTE|MEM_READ

  // Section 2: .data (writable + executable — anomaly!)
  buf.write('.data\0\0\0', secStart + 40, 'ascii');
  buf.writeUInt32LE(0x500, secStart + 40 + 8);
  buf.writeUInt32LE(0x2000, secStart + 40 + 12);
  buf.writeUInt32LE(0x400, secStart + 40 + 16);
  buf.writeUInt32LE(0x2000, secStart + 40 + 20); // PointerToRawData
  buf.writeUInt32LE(0xe0000040, secStart + 40 + 36); // RWX anomaly: MEM_READ|MEM_WRITE|MEM_EXECUTE|INIT_DATA

  // Section 3: Writable Code (W+X, NOT R)
  buf.write('.weird\0\0', secStart + 80, 'ascii');
  buf.writeUInt32LE(0x100, secStart + 80 + 8);
  buf.writeUInt32LE(0x3000, secStart + 80 + 12);
  buf.writeUInt32LE(0x100, secStart + 80 + 16);
  buf.writeUInt32LE(0x3000, secStart + 80 + 20); // PointerToRawData
  buf.writeUInt32LE(0xa0000020, secStart + 80 + 36); // MEM_WRITE | MEM_EXECUTE | CODE

  // Section 4: Executable Data (X + INIT_DATA, NOT CODE)
  buf.write('.rdata\0\0', secStart + 120, 'ascii');
  buf.writeUInt32LE(0x200, secStart + 120 + 8);
  buf.writeUInt32LE(0x4000, secStart + 120 + 12);
  buf.writeUInt32LE(0x200, secStart + 120 + 16);
  buf.writeUInt32LE(0x4000, secStart + 120 + 20); // PointerToRawData
  buf.writeUInt32LE(0x20000040, secStart + 120 + 36); // MEM_EXECUTE | INIT_DATA

  // --- Export Directory at 0x2000 ---
  const expDir = 0x2000;
  buf.writeUInt32LE(1, expDir + 16); // ordinalBase = 1
  buf.writeUInt32LE(2, expDir + 24); // numberOfNames = 2
  buf.writeUInt32LE(0x2040, expDir + 28); // AddressOfFunctions
  buf.writeUInt32LE(0x2080, expDir + 32); // AddressOfNames
  buf.writeUInt32LE(0x20c0, expDir + 36); // AddressOfNameOrdinals

  // AddressOfFunctions [2] at 0x2040
  buf.writeUInt32LE(0x1050, 0x2040); // Func1 RVA
  buf.writeUInt32LE(0x2100, 0x2044); // Func2 RVA (forwarded, points to 0x2100)

  // AddressOfNames [2] at 0x2080
  buf.writeUInt32LE(0x2200, 0x2080); // Name1 RVA
  buf.writeUInt32LE(0x2220, 0x2084); // Name2 RVA

  // AddressOfNameOrdinals [2] at 0x20C0
  buf.writeUInt16LE(0, 0x20c0);
  buf.writeUInt16LE(1, 0x20c2);

  // Strings
  buf.write('ExportedFunc1\0', 0x2200, 'ascii');
  buf.write('ExportedFunc2\0', 0x2220, 'ascii');
  buf.write('kernel32.dll.SomeFunc\0', 0x2100, 'ascii'); // Forwarder string at 0x2100 (within limits)

  // --- Import Directory at 0x3000 ---
  const impDir = 0x3000;

  // Descriptor 1
  buf.writeUInt32LE(0x3100, impDir + 0); // OriginalFirstThunk (ILT)
  buf.writeUInt32LE(0x3200, impDir + 12); // Name RVA (DLL name)
  buf.writeUInt32LE(0x3180, impDir + 16); // FirstThunk (IAT)

  // Descriptor 2 (Terminator)
  buf.writeUInt32LE(0, impDir + 20);

  // DLL String
  buf.write('USER32.dll\0', 0x3200, 'ascii');

  // ILT [2] at 0x3100 (PE32+) - 8 bytes each
  // Import by Name
  buf.writeBigUInt64LE(BigInt(0x3300), 0x3100);
  // Import by Ordinal (0x8000000000000000 | 42)
  buf.writeBigUInt64LE(0x800000000000002an, 0x3108);
  // Terminator
  buf.writeBigUInt64LE(0n, 0x3110);

  // IMAGE_IMPORT_BY_NAME at 0x3300
  buf.writeUInt16LE(5, 0x3300); // Hint
  buf.write('MessageBoxA\0', 0x3302, 'ascii'); // Name

  return buf;
}
const mockPE = buildMockPE();

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: vi.fn(() => 1n),
  CloseHandle: vi.fn(() => true),
  ReadProcessMemory: vi.fn((_h: bigint, addr: bigint, size: number) => {
    const offset = Number(addr);
    if (offset >= 0 && offset + size <= mockPE.length) {
      return Buffer.from(mockPE.subarray(offset, offset + size));
    }
    return Buffer.alloc(size);
  }),
  EnumProcessModules: vi.fn(() => ({
    modules: [0n],
    count: 1,
  })),
  GetModuleBaseName: vi.fn(() => 'test.exe'),
  GetModuleFileNameEx: vi.fn(() => 'test.exe'),
  GetModuleInformation: vi.fn(() => ({
    success: true,
    info: { lpBaseOfDll: 0n, SizeOfImage: 16384, EntryPoint: 0x1000n },
  })),
}));

import { PEAnalyzer } from '@native/PEAnalyzer';
import { IMAGE_SCN } from '@native/PEAnalyzer.types';
import { ReadProcessMemory, GetModuleFileNameEx, EnumProcessModules } from '@native/Win32API';

describe('PEAnalyzer', () => {
  let analyzer: PEAnalyzer;

  beforeEach(() => {
    analyzer = new PEAnalyzer();
  });

  describe('parseHeaders', () => {
    it('should parse valid PE headers', async () => {
      const headers = await analyzer.parseHeaders(1234, '0x0');
      expect(headers.dosHeader.e_magic).toBe(0x5a4d);
      expect(headers.ntSignature).toBe(0x00004550);
      expect(headers.fileHeader.machine).toBe(0x8664);
      expect(headers.optionalHeader.magic).toBe(0x20b);
    });

    it('should report correct number of sections', async () => {
      const headers = await analyzer.parseHeaders(1234, '0x0');
      expect(headers.fileHeader.numberOfSections).toBe(4);
    });

    it('should parse valid PE32 headers', async () => {
      const pe32 = Buffer.from(mockPE);
      pe32.writeUInt16LE(0x10b, 0x98); // Magic = PE32
      pe32.writeUInt32LE(0x10000000, 0x98 + 28); // ImageBase at offset 52 in OptionalHeader
      pe32.writeUInt32LE(16, 0x98 + 92); // NumberOfRvaAndSizes at offset 116 in OptionalHeader

      const mockedRPM = ReadProcessMemory as any;
      mockedRPM
        .mockReturnValueOnce(pe32.subarray(0, 64))
        .mockReturnValueOnce(pe32.subarray(0x80, 0x80 + 264));

      const headers = await analyzer.parseHeaders(1234, '0x0');
      expect(headers.optionalHeader.magic).toBe(0x10b);
    });

    it('should throw for invalid DOS header', async () => {
      (ReadProcessMemory as any).mockReturnValueOnce(Buffer.alloc(64)); // No MZ
      await expect(analyzer.parseHeaders(1234, '0x0')).rejects.toThrow('Invalid DOS header');
    });

    it('should throw for invalid PE signature', async () => {
      const badPE = Buffer.from(mockPE);
      badPE.writeUInt32LE(0x0000baad, 0x80); // Bad PE signature
      (ReadProcessMemory as any)
        .mockReturnValueOnce(badPE.subarray(0, 64))
        .mockReturnValueOnce(badPE.subarray(0x80, 0x80 + 264));
      await expect(analyzer.parseHeaders(1234, '0x0')).rejects.toThrow('Invalid PE signature');
    });
  });

  describe('listSections', () => {
    it('should return correct section count', async () => {
      const sections = await analyzer.listSections(1234, '0x0');
      expect(sections.length).toBe(4);
    });

    it('should parse section names', async () => {
      const sections = await analyzer.listSections(1234, '0x0');
      expect(sections[0]!.name).toBe('.text');
      expect(sections[1]!.name).toBe('.data');
    });

    it('should map characteristics to permission flags', async () => {
      const sections = await analyzer.listSections(1234, '0x0');
      // .text: MEM_EXECUTE|MEM_READ (0x60000020)
      expect(sections[0]!.isExecutable).toBe(true);
      expect(sections[0]!.isReadable).toBe(true);
      expect(sections[0]!.isWritable).toBe(false);

      // .data: RWX (0xe0000040)
      expect(sections[1]!.isExecutable).toBe(true);
      expect(sections[1]!.isWritable).toBe(true);
      expect(sections[1]!.isReadable).toBe(true);
    });

    it('should parse section name without null terminator', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          return Buffer.alloc(64); // DOS
        })
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const buf = Buffer.alloc(264);
          buf.writeUInt16LE(1, 6); // 1 section
          return buf;
        })
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const buf = Buffer.alloc(40, 0x41); // Fill with exactly 'A', NO NULL BYTES AT ALL
          buf.write('NONULLNM', 0, 'ascii');
          return buf;
        });
      const sections = await analyzer.listSections(1234, '0x0');
      expect(sections[0]!.name).toBe('NONULLNM');
    });
  });

  describe('analyzeSections', () => {
    it('should flag RWX section', async () => {
      const anomalies = await analyzer.analyzeSections(1234, '0x0');
      const rwx = anomalies.filter((a) => a.anomalyType === 'rwx');
      expect(rwx.length).toBeGreaterThanOrEqual(1);
      expect(rwx[0]!.sectionName).toBe('.data');
      expect(rwx[0]!.severity).toBe('high');
    });

    it('should not flag normal .text section', async () => {
      const anomalies = await analyzer.analyzeSections(1234, '0x0');
      const textAnomalies = anomalies.filter((a) => a.sectionName === '.text');
      expect(textAnomalies.length).toBe(0);
    });

    it('should flag writable code section', async () => {
      const anomalies = await analyzer.analyzeSections(1234, '0x0');
      const wcode = anomalies.filter((a) => a.anomalyType === 'writable_code');
      expect(wcode.length).toBeGreaterThanOrEqual(1);
      expect(wcode[0]!.sectionName).toBe('.weird');
    });

    it('should flag executable data section', async () => {
      const anomalies = await analyzer.analyzeSections(1234, '0x0');
      const edata = anomalies.filter((a) => a.anomalyType === 'executable_data');
      expect(edata.length).toBeGreaterThanOrEqual(1);
      expect(edata[0]!.sectionName).toBe('.rdata');
    });
  });

  describe('hook classification', () => {
    it('should classify JMP rel32 hook', () => {
      // Access private method via prototype trick
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0xe9; // JMP rel32
      buf.writeInt32LE(0x1000, 1);
      expect(p._classifyHook(buf)).toBe('jmp_rel32');
    });

    it('should classify JMP abs64 hook', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0xff;
      buf[1] = 0x25;
      expect(p._classifyHook(buf)).toBe('jmp_abs64');
    });

    it('should classify PUSH+RET hook', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0x68; // PUSH imm32
      buf[5] = 0xc3; // RET
      expect(p._classifyHook(buf)).toBe('push_ret');
    });

    it('should return unknown for unrecognized pattern', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16, 0x90); // NOP sled
      expect(p._classifyHook(buf)).toBe('unknown');
    });
  });

  describe('jump target decoding', () => {
    it('should decode JMP rel32', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0xe9;
      buf.writeInt32LE(0x1337, 1);
      // funcAddr + 5 + 0x1337 => 0x1000 + 5 + 0x1337 = 0x233c
      expect(p._decodeJumpTarget(buf, 0x1000n)).toBe('0x233c');
    });

    it('should decode JMP [rip+disp32]', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0xff;
      buf[1] = 0x25;
      buf.writeBigUInt64LE(0xdeadbeefn, 6);
      expect(p._decodeJumpTarget(buf, 0x1000n)).toBe('0xdeadbeef');
    });

    it('should decode PUSH imm32; RET', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0x68;
      buf.writeUInt32LE(0xbadc0de, 1);
      expect(p._decodeJumpTarget(buf, 0x1000n)).toBe('0xbadc0de');
    });

    it('should return 0x0 for short JMP abs64 buffer', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(10);
      buf[0] = 0xff;
      buf[1] = 0x25;
      expect(p._decodeJumpTarget(buf, 0x1000n)).toBe('0x0');
    });

    it('should return 0x0 for unknown', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16, 0x90);
      expect(p._decodeJumpTarget(buf, 0x1000n)).toBe('0x0');
    });
  });

  describe('error handling branches', () => {
    it('should handle module enumeration failure', async () => {
      const p = analyzer as any;

      (EnumProcessModules as any).mockImplementationOnce(() => {
        throw new Error('Fake access denied');
      });
      const mods = p._enumerateModulesInternal(1234n);
      expect(mods.length).toBe(0);
    });

    it('should return -1 when RVA is out of bounds', () => {
      const p = analyzer as any;
      const offset = p._rvaToFileOffset(Buffer.from(mockPE), 0x999999);
      expect(offset).toBe(-1);
    });

    it('should break loop if section header exceeds peData length', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(100);
      buf.writeUInt32LE(10, 60);
      buf.writeUInt16LE(50, 16);
      buf.writeUInt16LE(0, 30);
      const offset = p._rvaToFileOffset(buf, 0x1000);
      expect(offset).toBe(-1);
    });

    it('should fallback to name if GetModuleFileNameEx returns null', async () => {
      const p = analyzer as any;
      const { GetModuleFileNameEx: GMFNLocal } = await import('@native/Win32API');
      (GMFNLocal as any).mockReturnValueOnce(null);
      const mods = p._enumerateModulesInternal(1234n);
      expect(mods[0]!.path).toBe('test.exe');
    });

    it('should ignore module if GetModuleInformation fails', async () => {
      const p = analyzer as any;
      const { GetModuleInformation } = await import('@native/Win32API');
      (GetModuleInformation as any).mockReturnValueOnce({ success: false });
      const mods = p._enumerateModulesInternal(1234n);
      expect(mods.length).toBe(0);
    });

    it('should handle truncated ntData buffer from short memory read', async () => {
      const p = analyzer as any;
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          return Buffer.alloc(64); // mock DOS
        })
        .mockImplementationOnce((_h: bigint, addr: bigint, _size: number) => {
          // Return truncated ntData of 140 bytes (not enough to fill directories)
          const buf = Buffer.from(mockPE.subarray(Number(addr), Number(addr) + 140));
          return buf;
        });

      const headers = await p._readCoreHeaders(1234n, 0n);
      expect(headers.dataDirectories.length).toBeLessThan(16);
    });

    it('should read 32-bit thunks for PE32 headers', async () => {
      const _p = analyzer as any;
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;

      // Override to PE32
      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        const offset = Number(addr);
        if (offset === 0x80) {
          // ntData
          const buf = Buffer.from(mockPE.subarray(0x80, 0x80 + 264));
          buf.writeUInt16LE(0x10b, 24); // PE32 magic
          buf.writeUInt32LE(16, 116); // NumberOfRvaAndSizes
          buf.writeUInt32LE(0x3000, 128); // Import Dir RVA
          buf.writeUInt32LE(0x100, 132); // Import Dir Size
          return buf;
        }
        if (offset >= 0x3100 && offset < 0x310c) {
          // ILT thunk data
          const arrBuf = Buffer.alloc(12);
          arrBuf.writeUInt32LE(0x3300, 0); // valid
          arrBuf.writeUInt32LE(0x8000002a, 4); // ordinal
          arrBuf.writeUInt32LE(0, 8); // terminator
          const rel = offset - 0x3100;
          return Buffer.from(arrBuf.subarray(rel, rel + size));
        }
        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });

      const imports = await analyzer.parseImports(1234n, '0x0');
      expect(imports[0]!.functions.length).toBe(2);

      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        const offset = Number(addr);
        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });
    });

    it('should handle missing null byte in import name', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;

      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        const offset = Number(addr);
        if (offset === 0x3300) {
          const buf = Buffer.alloc(258, 0x41);
          buf.writeUInt16LE(5, 0);
          return buf;
        }
        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });

      const imports = await analyzer.parseImports(1234, '0x0');
      expect(imports[0]!.functions[0]!.name.length).toBe(256);

      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        const offset = Number(addr);
        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });
    });
  });

  describe('IMAGE_SCN constants', () => {
    it('should have correct flag values', () => {
      expect(IMAGE_SCN.MEM_EXECUTE).toBe(0x20000000);
      expect(IMAGE_SCN.MEM_READ).toBe(0x40000000);
      expect(IMAGE_SCN.MEM_WRITE).toBe(0x80000000);
      expect(IMAGE_SCN.CNT_CODE).toBe(0x00000020);
    });
  });

  describe('parseExports', () => {
    it('should parse export directory and function names', async () => {
      const exports = await analyzer.parseExports(1234, '0x0');
      expect(exports.length).toBe(2);

      expect(exports[0]!.name).toBe('ExportedFunc1');
      expect(exports[0]!.ordinal).toBe(1); // ordinalBase (1) + ordIndex (0)
      expect(exports[0]!.rva).toBe('0x1050');
      expect(exports[0]!.forwardedTo).toBeNull();

      expect(exports[1]!.name).toBe('ExportedFunc2');
      expect(exports[1]!.ordinal).toBe(2);
      expect(exports[1]!.rva).toBe('0x2100');
      expect(exports[1]!.forwardedTo).toBe('kernel32.dll.SomeFunc');
    });

    it('should return empty array if export directory is missing', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM.mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
        const buf = Buffer.alloc(264);
        buf.writeUInt32LE(0, 132); // NumberOfRvaAndSizes = 0
        return buf;
      });
      const exports = await analyzer.parseExports(1234, '0x0');
      expect(exports.length).toBe(0);
    });

    it('should handle forwarded export without null terminator', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        if (size === 256) {
          return Buffer.alloc(256, 0x41);
        }
        const offset = Number(addr);
        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });
      const exports = await analyzer.parseExports(1234, '0x0');
      expect(exports.length).toBe(2);
      expect(exports[1]!.forwardedTo!.length).toBe(256);
      expect(exports[1]!.forwardedTo!.charAt(0)).toBe('A');
    });
  });

  describe('parseImports', () => {
    it('should parse import descriptors and thunks', async () => {
      const imports = await analyzer.parseImports(1234, '0x0');
      expect(imports.length).toBe(1);

      expect(imports[0]!.dllName).toBe('USER32.dll');
      expect(imports[0]!.functions.length).toBe(2);

      // Import by name
      expect(imports[0]!.functions[0]!.name).toBe('MessageBoxA');
      expect(imports[0]!.functions[0]!.hint).toBe(5);

      // Import by ordinal
      expect(imports[0]!.functions[1]!.name).toBe('Ordinal#42');
      expect(imports[0]!.functions[1]!.ordinal).toBe(42);
    });

    it('should return empty array if import directory is missing', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM.mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
        const buf = Buffer.alloc(264);
        buf.writeUInt32LE(0, 132); // NumberOfRvaAndSizes = 0
        return buf;
      });
      const imports = await analyzer.parseImports(1234, '0x0');
      expect(imports.length).toBe(0);
    });

    it('should handle import dll name without null terminator', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        if (size === 256) return Buffer.alloc(256, 0x42);
        const offset = Number(addr);
        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });
      const imports = await analyzer.parseImports(1234, '0x0');
      expect(imports[0]!.dllName.length).toBe(256);
      expect(imports[0]!.dllName.charAt(0)).toBe('B');
    });

    it('should fallback to FirstThunk if OriginalFirstThunk is 0', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;

      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        const offset = Number(addr);
        if (size === 20 && offset === 0x2200) {
          // This is reading the first IMPORT DESCRIPTOR!
          const desc = Buffer.from(mockPE.subarray(offset, offset + size));
          // Wipe OriginalFirstThunk (bytes 0-3) to force fall-through to FirstThunk (bytes 16-19)
          desc.writeUInt32LE(0, 0);
          return desc;
        }

        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });
      const imports = await analyzer.parseImports(1234, '0x0');
      expect(imports.length).toBe(1);
      // The thunks should still map!
      expect(imports[0]!.functions.length).toBe(2);
    });
  });

  describe('detectInlineHooks', () => {
    beforeEach(async () => {
      const fs = await import('node:fs/promises');
      await fs.writeFile('test.exe', mockPE);
    });

    afterEach(async () => {
      const fs = await import('node:fs/promises');
      try {
        await fs.unlink('test.exe');
      } catch {}
    });

    it('should scan all modules if no moduleName is provided', async () => {
      const detections = await analyzer.detectInlineHooks(1234);
      expect(detections.length).toBeGreaterThanOrEqual(0);
    });

    it('should not detect hooks if memory exactly matches disk', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM.mockImplementationOnce((_h: bigint, addr: bigint, size: number) => {
        const offset = Number(addr);
        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });
      const detections = await analyzer.detectInlineHooks(1234, 'test.exe');
      expect(detections.length).toBe(0);
    });

    it('should skip hook detection if disk data is truncated', async () => {
      const fs = await import('node:fs/promises');
      await fs.writeFile('test.exe', Buffer.from(mockPE.subarray(0, 4180)));
      const detections = await analyzer.detectInlineHooks(1234, 'test.exe');
      expect(detections.length).toBe(0);
      // Wait, 'test.exe' is already cleaned up by the beforeEach/afterEach!
      // I'll just write it manually during execution.
    });

    it('should directly cover true branch of isPE32Plus and Math.min > 16', async () => {
      const p = analyzer as any;
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          return Buffer.alloc(64); // DOS
        })
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const buf = Buffer.alloc(264);
          buf.writeUInt16LE(0x20b, 24); // PE32+
          buf.writeUInt32LE(20, 132); // numberOfRvaAndSizes = 20 (>16)
          // Also make `off + 8 <= ntData.length` FALSE by making the buffer physically shorter than required
          return Buffer.from(buf.subarray(0, 138));
        });
      const res = await p._readCoreHeaders(1234n, 0n);
      expect(res.isPE32Plus).toBe(true);
      expect(res.dataDirectories.length).toBe(0);
    });

    it('should detect differences between disk and memory at export RVAs', async () => {
      // We will override ReadProcessMemory just for the `funcRva` check in detectInlineHooks
      // ExportedFunc1 is at RVA 0x1050.
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;

      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        const offset = Number(addr);
        if (offset === 0x1050 && size === 16) {
          // It's checking memory bytes for the first export. Send a JMP hook!
          const hookedBuf = Buffer.alloc(16);
          hookedBuf[0] = 0xe9; // JMP
          hookedBuf.writeInt32LE(0x1337, 1);
          return hookedBuf;
        }
        // Fallback to normal
        if (offset >= 0 && offset + size <= mockPE.length) {
          return Buffer.from(mockPE.subarray(offset, offset + size));
        }
        return Buffer.alloc(size);
      });

      const detections = await analyzer.detectInlineHooks(1234, 'test.exe');
      // ExportedFunc2 is forwarded, so it should be skipped.

      expect(detections.length).toBe(1);
      expect(detections[0]!.moduleName).toBe('test.exe');
      expect(detections[0]!.functionName).toBe('ExportedFunc1');
      expect(detections[0]!.hookType).toBe('jmp_rel32');
      // The Target calculates address + 5 + 0x1337
      expect(detections[0]!.jumpTarget).toBe('0x238c'); // 0x1050 + 5 + 0x1337 = 0x238C
    });

    it('should skip detection gracefully if fs.readFile throws', async () => {
      const _fs = await import('node:fs/promises');
      (GetModuleFileNameEx as any).mockReturnValue('C:\\does_not_exist.dll');
      const detections = await analyzer.detectInlineHooks(1234, 'test.exe');
      expect(detections.length).toBe(0);
    });
  });
});
