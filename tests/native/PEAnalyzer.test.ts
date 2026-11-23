/**
 * PEAnalyzer — unit tests.
 *
 * Builds synthetic PE data in mock ReadProcessMemory to test header parsing,
 * section listing, import/export resolution, inline hook detection, and anomaly analysis.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// The disk image that `detectInlineHooks` compares against memory is read from
// `mod.path`, which the mocked `GetModuleFileNameEx` supplies. Both the fixture
// and the mock therefore have to agree on an ABSOLUTE path outside the
// repository: a bare `'test.exe'` resolves against `process.cwd()`, which is the
// repository root under vitest, so the fixture was written into the working tree
// and only removed when the `afterEach` unlink happened to succeed — leaving a
// 16 KB stray `test.exe` behind for anything that interrupted the run.
const PE_FIXTURE_DIR = join(tmpdir(), 'jshookmcp-pe-analyzer');
const PE_FIXTURE_PATH = join(PE_FIXTURE_DIR, 'test.exe');

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
  // Absolute on purpose — see PE_FIXTURE_PATH. `name` stays 'test.exe' so the
  // moduleName filter and the reported `moduleName` keep their existing shape.
  GetModuleFileNameEx: vi.fn(() => PE_FIXTURE_PATH),
  GetModuleInformation: vi.fn(() => ({
    success: true,
    info: { lpBaseOfDll: 0n, SizeOfImage: 16384, EntryPoint: 0x1000n },
  })),
}));

import { PEAnalyzer } from '@native/PEAnalyzer';
import { IMAGE_SCN } from '@native/PEAnalyzer.types';
import {
  ReadProcessMemory,
  GetModuleFileNameEx,
  GetModuleBaseName,
  GetModuleInformation,
  EnumProcessModules,
} from '@native/Win32API';

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
          const dos = Buffer.alloc(64);
          dos.writeUInt16LE(0x5a4d, 0); // MZ
          dos.writeUInt32LE(0x80, 60); // e_lfanew
          return dos; // DOS
        })
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const buf = Buffer.alloc(264);
          buf.writeUInt32LE(0x00004550, 0); // PE\0\0
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
    // `analyzer` is assigned lazily at module load; capture it per-test.
    let p: any;
    beforeEach(() => {
      p = analyzer as any;
    });

    it('should classify JMP rel32 hook', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xe9; // JMP rel32
      buf.writeInt32LE(0x1000, 1);
      expect(p.classifyHook(buf)).toBe('jmp_rel32');
    });

    it('should classify CALL rel32 hook (pe-sieve direct call)', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xe8; // CALL rel32
      buf.writeInt32LE(0x1000, 1);
      expect(p.classifyHook(buf)).toBe('call_rel32');
    });

    it('should classify short JMP rel8 hook', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xeb; // JMP rel8
      buf.writeInt8(0x20, 1);
      expect(p.classifyHook(buf)).toBe('short_jmp');
    });

    it('should classify JMP abs64 hook', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xff;
      buf[1] = 0x25;
      expect(p.classifyHook(buf)).toBe('jmp_abs64');
    });

    it('should classify MOV+JMP hook (mov reg,imm32; jmp reg)', () => {
      const buf = Buffer.alloc(16, 0);
      buf[0] = 0xb8; // MOV EAX, imm32
      buf.writeUInt32LE(0x401000, 1);
      buf[5] = 0xff; // JMP r/m32 (B8 imm32=4bytes → FF at index 5)
      buf[6] = 0xe0; // E0 = JMP EAX (modrm at index 6)
      expect(p.classifyHook(buf)).toBe('mov_jmp');
    });

    it('should classify MOV+CALL hook (mov reg,imm32; call reg)', () => {
      const buf = Buffer.alloc(16, 0);
      buf[0] = 0xb9; // MOV ECX, imm32
      buf.writeUInt32LE(0x402000, 1);
      buf[5] = 0xff;
      buf[6] = 0xd1; // D1 = CALL ECX
      expect(p.classifyHook(buf)).toBe('mov_call');
    });

    it('should classify PUSH+RET hook', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0x68; // PUSH imm32
      buf[5] = 0xc3; // RET
      expect(p.classifyHook(buf)).toBe('push_ret');
    });

    it('should classify INT3 breakpoint', () => {
      const buf = Buffer.alloc(16, 0x90);
      buf[0] = 0xcc;
      expect(p.classifyHook(buf)).toBe('int3_breakpoint');
    });

    it('should classify padding (NOP sled / zero-fill)', () => {
      const buf = Buffer.alloc(16, 0x90); // all NOP
      expect(p.classifyHook(buf)).toBe('padding');
    });

    it('should return unknown for unrecognized pattern (normal prologue)', () => {
      // push rbp; mov rbp,rsp — a real function prologue, not a hook.
      const buf = Buffer.alloc(16, 0);
      buf[0] = 0x55;
      buf[1] = 0x48;
      buf[2] = 0x89;
      buf[3] = 0xe5;
      expect(p.classifyHook(buf)).toBe('unknown');
    });

    it('should return unknown for empty buffer', () => {
      expect(p.classifyHook(Buffer.alloc(0))).toBe('unknown');
    });
  });

  describe('hook target decoding', () => {
    let p: any;
    beforeEach(() => {
      p = analyzer as any;
    });

    it('should decode JMP rel32 target (funcAddr + 5 + rel32)', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xe9;
      buf.writeInt32LE(0x1337, 1);
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x233c'); // 0x1000 + 5 + 0x1337
    });

    it('should decode CALL rel32 target (funcAddr + 5 + rel32)', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xe8;
      buf.writeInt32LE(0x1337, 1);
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x233c');
    });

    it('should decode short JMP rel8 target (funcAddr + 2 + rel8)', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xeb;
      buf.writeInt8(0x10, 1);
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x1012'); // 0x1000 + 2 + 0x10
    });

    it('should decode MOV+JMP target as the MOV immediate', () => {
      const buf = Buffer.alloc(16, 0);
      buf[0] = 0xb8;
      buf.writeUInt32LE(0x401000, 1);
      buf[6] = 0xff;
      buf[7] = 0xe0;
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x401000');
    });

    it('should decode PUSH+RET target as the pushed immediate', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0x68;
      buf.writeUInt32LE(0x401000, 1);
      buf[5] = 0xc3;
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x401000');
    });

    it('should return 0x0 for INT3 breakpoint (no target)', () => {
      const buf = Buffer.alloc(16, 0x90);
      buf[0] = 0xcc;
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x0');
    });

    it('should return 0x0 for padding (no target)', () => {
      const buf = Buffer.alloc(16, 0x90);
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x0');
    });

    it('should return 0x0 for unknown pattern', () => {
      const buf = Buffer.alloc(16, 0);
      buf[0] = 0x55;
      buf[1] = 0x48;
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x0');
    });
  });

  describe('jump target decoding', () => {
    it('should decode JMP rel32', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0xe9;
      buf.writeInt32LE(0x1337, 1);
      // funcAddr + 5 + 0x1337 => 0x1000 + 5 + 0x1337 = 0x233c
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x233c');
    });

    it('should decode JMP [rip+disp32]', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0xff;
      buf[1] = 0x25;
      buf.writeBigUInt64LE(0xdeadbeefn, 6);
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0xdeadbeef');
    });

    it('should decode PUSH imm32; RET', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0x68;
      buf.writeUInt32LE(0xbadc0de, 1);
      buf[5] = 0xc3; // RET — completes the push_ret pattern (HookPatternScanner requires it)
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0xbadc0de');
    });

    it('should return 0x0 for short JMP abs64 buffer', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(10);
      buf[0] = 0xff;
      buf[1] = 0x25;
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x0');
    });

    it('should return 0x0 for unknown', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(16, 0x90);
      expect(p.decodeJumpTarget(buf, 0x1000n)).toBe('0x0');
    });
  });

  describe('error handling branches', () => {
    it('should handle module enumeration failure', async () => {
      const p = analyzer as any;

      (EnumProcessModules as any).mockImplementationOnce(() => {
        throw new Error('Fake access denied');
      });
      const mods = p.enumerateModulesInternal(1234n);
      expect(mods.length).toBe(0);
    });

    it('should return -1 when RVA is out of bounds', () => {
      const p = analyzer as any;
      const offset = p.rvaToFileOffset(Buffer.from(mockPE), 0x999999);
      expect(offset).toBe(-1);
    });

    it('should break loop if section header exceeds peData length', () => {
      const p = analyzer as any;
      const buf = Buffer.alloc(100);
      buf.writeUInt32LE(10, 60);
      buf.writeUInt16LE(50, 16);
      buf.writeUInt16LE(0, 30);
      const offset = p.rvaToFileOffset(buf, 0x1000);
      expect(offset).toBe(-1);
    });

    it('should fallback to name if GetModuleFileNameEx returns null', async () => {
      const p = analyzer as any;
      const { GetModuleFileNameEx: GMFNLocal } = await import('@native/Win32API');
      (GMFNLocal as any).mockReturnValueOnce(null);
      const mods = p.enumerateModulesInternal(1234n);
      expect(mods[0]!.path).toBe('test.exe');
    });

    it('should ignore module if GetModuleInformation fails', async () => {
      const p = analyzer as any;
      const { GetModuleInformation: GMI } = await import('@native/Win32API');
      (GMI as any).mockReturnValueOnce({ success: false });
      const mods = p.enumerateModulesInternal(1234n);
      expect(mods.length).toBe(0);
    });

    it('should handle truncated ntData buffer from short memory read', async () => {
      const p = analyzer as any;
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const dos = Buffer.alloc(64);
          dos.writeUInt16LE(0x5a4d, 0); // MZ
          dos.writeUInt32LE(0x80, 60); // e_lfanew
          return dos; // mock DOS
        })
        .mockImplementationOnce((_h: bigint, addr: bigint, _size: number) => {
          // Return truncated ntData of 140 bytes (not enough to fill directories)
          const buf = Buffer.from(mockPE.subarray(Number(addr), Number(addr) + 140));
          return buf;
        });

      const headers = await p.readCoreHeaders(1234n, 0n);
      expect(headers.dataDirectories.length).toBeLessThan(16);
    });

    it('should read 32-bit thunks for PE32 headers', async () => {
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

      // @ts-expect-error
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
      originalRPM
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const dos = Buffer.alloc(64);
          dos.writeUInt16LE(0x5a4d, 0); // MZ
          dos.writeUInt32LE(0x80, 60); // e_lfanew
          return dos; // DOS
        })
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          // Valid PE32+ header with zeroed data directories (no export dir)
          const buf = Buffer.alloc(264);
          buf.writeUInt32LE(0x00004550, 0); // PE\0\0
          buf.writeUInt16LE(0x20b, 24); // PE32+ magic
          buf.writeUInt32LE(16, 132); // NumberOfRvaAndSizes
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
      originalRPM
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const dos = Buffer.alloc(64);
          dos.writeUInt16LE(0x5a4d, 0); // MZ
          dos.writeUInt32LE(0x80, 60); // e_lfanew
          return dos; // DOS
        })
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          // Valid PE32+ header with zeroed data directories (no import dir)
          const buf = Buffer.alloc(264);
          buf.writeUInt32LE(0x00004550, 0); // PE\0\0
          buf.writeUInt16LE(0x20b, 24); // PE32+ magic
          buf.writeUInt32LE(16, 132); // NumberOfRvaAndSizes
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

    it('lists the DLL without functions when OriginalFirstThunk is 0', async () => {
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;

      originalRPM.mockImplementation((_h: bigint, addr: bigint, size: number) => {
        const offset = Number(addr);
        if (size === 20 && offset === 0x3000) {
          // This is reading the first IMPORT DESCRIPTOR!
          const desc = Buffer.from(mockPE.subarray(offset, offset + size));
          // Wipe OriginalFirstThunk (bytes 0-3); FirstThunk now holds
          // loader-resolved addresses in a live process, so it must not be
          // interpreted as an INT.
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
      // Names cannot be recovered without the INT; do not fabricate them.
      expect(imports[0]!.functions.length).toBe(0);
    });
  });

  describe('detectInlineHooks', () => {
    beforeEach(async () => {
      await mkdir(PE_FIXTURE_DIR, { recursive: true });
      await writeFile(PE_FIXTURE_PATH, mockPE);
    });

    afterEach(async () => {
      await rm(PE_FIXTURE_PATH, { force: true });
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
      // Overwrite the fixture the beforeEach wrote with a truncated variant —
      // that truncation is the whole point of this case, so it cannot come from
      // the shared setup.
      await writeFile(PE_FIXTURE_PATH, Buffer.from(mockPE.subarray(0, 4180)));
      const detections = await analyzer.detectInlineHooks(1234, 'test.exe');
      expect(detections.length).toBe(0);
    });

    it('should directly cover true branch of isPE32Plus and Math.min > 16', async () => {
      const p = analyzer as any;
      const { ReadProcessMemory: RPMLocal } = await import('@native/Win32API');
      const originalRPM = RPMLocal as any;
      originalRPM
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const dos = Buffer.alloc(64);
          dos.writeUInt16LE(0x5a4d, 0); // MZ
          dos.writeUInt32LE(0x80, 60); // e_lfanew
          return dos; // DOS
        })
        .mockImplementationOnce((_h: bigint, _addr: bigint, _size: number) => {
          const buf = Buffer.alloc(264);
          buf.writeUInt32LE(0x00004550, 0); // PE\0\0
          buf.writeUInt16LE(0x20b, 24); // PE32+
          buf.writeUInt32LE(20, 132); // numberOfRvaAndSizes = 20 (>16)
          // Also make `off + 8 <= ntData.length` FALSE by making the buffer physically shorter than required
          return Buffer.from(buf.subarray(0, 138));
        });
      const res = await p.readCoreHeaders(1234n, 0n);
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
      (GetModuleFileNameEx as any).mockReturnValue('C:\\does_not_exist.dll');
      const detections = await analyzer.detectInlineHooks(1234, 'test.exe');
      expect(detections.length).toBe(0);
    });
  });
});

describe('detectIATHooks — forwarded exports', () => {
  const analyzer = new PEAnalyzer();
  const memRegions = new Map<number, Buffer>();

  /** Register a memory region at an absolute address (base 0 in this fixture). */
  const install = (addr: number, buf: Buffer): void => {
    memRegions.set(addr, buf);
  };

  /**
   * Minimal PE32+ image (DOS + NT headers) with the given data directories.
   * NOTE: directories must live OUTSIDE the 264-byte NT-header region
   * ([base+0x40, base+0x148)) or the region-first memory mock returns the
   * header bytes instead of the directory contents.
   */
  function installPeImage(
    base: number,
    dirs: Array<{ index: number; rva: number; size: number }>,
  ): void {
    const dos = Buffer.alloc(64, 0);
    dos.writeUInt16LE(0x5a4d, 0); // MZ
    dos.writeUInt32LE(0x40, 60); // e_lfanew
    install(base, dos);

    const nt = Buffer.alloc(264, 0);
    nt.writeUInt32LE(0x00004550, 0); // PE\0\0
    nt.writeUInt16LE(0x8664, 4); // AMD64
    nt.writeUInt16LE(1, 6); // numberOfSections
    nt.writeUInt16LE(240, 20); // SizeOfOptionalHeader
    nt.writeUInt16LE(0x20b, 24); // PE32+
    nt.writeUInt32LE(16, 132); // NumberOfRvaAndSizes
    for (const d of dirs) {
      nt.writeUInt32LE(d.rva, 136 + d.index * 8);
      nt.writeUInt32LE(d.size, 136 + d.index * 8 + 4);
    }
    install(base + 0x40, nt);
  }

  beforeEach(() => {
    memRegions.clear();
    const rpm = ReadProcessMemory as any;
    // Real ReadProcessMemory semantics: a read may span/cross regions and
    // short strings must still be readable via a large request (zero-filled
    // tail), exactly like an actual page-aligned read in the target process.
    rpm.mockImplementation((_h: bigint, addr: bigint, size: number) => {
      const off = Number(addr);
      for (const [regionBase, region] of memRegions) {
        if (off >= regionBase && off < regionBase + region.length) {
          const start = off - regionBase;
          const end = Math.min(start + size, region.length);
          const out = Buffer.alloc(size, 0);
          region.copy(out, 0, start, end);
          return out;
        }
      }
      return Buffer.alloc(size);
    });
  });

  it('skips IAT entries whose source export is forwarded; flags genuine hooks', async () => {
    // ── Module A (consumer): imports ForwardedFunc + NormalFunc from B.dll.
    const A = 0x10000;
    installPeImage(A, [{ index: 1, rva: 0x200, size: 0x100 }]); // IMPORT dir

    const desc = Buffer.alloc(20, 0);
    desc.writeUInt32LE(0x260, 0); // OriginalFirstThunk (INT)
    desc.writeUInt32LE(0x2a0, 12); // DLL name RVA
    desc.writeUInt32LE(0x240, 16); // FirstThunk (IAT)
    install(A + 0x200, desc);
    install(A + 0x200 + 20, Buffer.alloc(20, 0)); // descriptor terminator

    // IAT: forwarded func → 0x60000 (module C), hooked func → 0x70000 (nowhere).
    const iat = Buffer.alloc(24, 0);
    iat.writeBigUInt64LE(0x60000n, 0);
    iat.writeBigUInt64LE(0x70000n, 8);
    install(A + 0x240, iat);

    const int = Buffer.alloc(24, 0);
    int.writeBigUInt64LE(0x2c0n, 0); // hint/name for ForwardedFunc
    int.writeBigUInt64LE(0x3c2n, 8); // hint/name for NormalFunc (after hn1's 258B region)
    install(A + 0x260, int);

    install(A + 0x2a0, Buffer.from('B.dll\0', 'ascii'));
    const hn1 = Buffer.alloc(258, 0);
    hn1.writeUInt16LE(1, 0);
    hn1.write('ForwardedFunc\0', 2, 'ascii');
    install(A + 0x2c0, hn1);
    const hn2 = Buffer.alloc(258, 0);
    hn2.writeUInt16LE(2, 0);
    hn2.write('NormalFunc\0', 2, 'ascii');
    install(A + 0x3c2, hn2);

    // ── Module B (source DLL): exports ForwardedFunc (forwarded) + NormalFunc.
    const B = 0x40000;
    installPeImage(B, [{ index: 0, rva: 0x200, size: 0x100 }]); // EXPORT dir

    const exp = Buffer.alloc(40, 0);
    exp.writeUInt32LE(1, 16); // ordinalBase
    exp.writeUInt32LE(2, 24); // numberOfNames
    exp.writeUInt32LE(0x300, 28); // AddressOfFunctions
    exp.writeUInt32LE(0x340, 32); // AddressOfNames
    exp.writeUInt32LE(0x380, 36); // AddressOfNameOrdinals
    install(B + 0x200, exp);

    const funcs = Buffer.alloc(8, 0);
    funcs.writeUInt32LE(0x220, 0); // ForwardedFunc RVA → inside export dir (forward string)
    funcs.writeUInt32LE(0x1100, 4); // NormalFunc RVA
    install(B + 0x300, funcs);

    const names = Buffer.alloc(8, 0);
    names.writeUInt32LE(0x3c0, 0);
    names.writeUInt32LE(0x3e0, 4);
    install(B + 0x340, names);

    const ords = Buffer.alloc(4, 0);
    ords.writeUInt16LE(0, 0);
    ords.writeUInt16LE(1, 2);
    install(B + 0x380, ords);

    install(B + 0x3c0, Buffer.from('ForwardedFunc\0', 'ascii'));
    install(B + 0x3e0, Buffer.from('NormalFunc\0', 'ascii'));
    install(B + 0x220, Buffer.from('C.dll.NormalFunc\0', 'ascii')); // forward string
    install(B + 0x1100, Buffer.alloc(32, 0x90)); // real function body

    // ── Module C: the forwarded target's range.
    const C = 0x60000;
    installPeImage(C, []);

    // Modules A (consumer), B (source), C (forward target).
    (EnumProcessModules as any).mockReturnValueOnce({
      modules: [0x10n, 0x20n, 0x30n],
      count: 3,
    });
    (GetModuleBaseName as any).mockImplementation((_h: bigint, mod: bigint) =>
      mod === 0x10n ? 'A.exe' : mod === 0x20n ? 'B.dll' : 'C.dll',
    );
    (GetModuleInformation as any).mockImplementation((_h: bigint, mod: bigint) => ({
      success: true,
      info: {
        lpBaseOfDll: mod === 0x10n ? 0x10000n : mod === 0x20n ? 0x40000n : 0x60000n,
        SizeOfImage: 0x2000,
        EntryPoint: 0x1000n,
      },
    }));

    const detections = await analyzer.detectIATHooks(1234, 'A.exe');
    expect(detections.map((d) => d.functionName)).toEqual(['NormalFunc']);

    // ForwardedFunc → 0x60000 (module C) is a legitimate forward chain — skipped.
    // NormalFunc → 0x70000 (outside B) is a real IAT hook — reported.
    expect(detections).toHaveLength(1);
    expect(detections[0]!.functionName).toBe('NormalFunc');
    expect(detections[0]!.actualTarget).toBe('0x70000');
    expect(detections[0]!.importDll).toBe('B.dll');
  });

  it('reports hooks even when the source module has no export table', async () => {
    // ── Module A: imports "BareFunc" from B.dll; B has NO export dir.
    const A = 0x10000;
    installPeImage(A, [{ index: 1, rva: 0x200, size: 0x100 }]);

    const desc = Buffer.alloc(20, 0);
    desc.writeUInt32LE(0x260, 0); // OriginalFirstThunk (INT)
    desc.writeUInt32LE(0x2a0, 12); // DLL name RVA
    desc.writeUInt32LE(0x240, 16); // FirstThunk (IAT)
    install(A + 0x200, desc);
    install(A + 0x200 + 20, Buffer.alloc(20, 0));

    const iat = Buffer.alloc(16, 0);
    iat.writeBigUInt64LE(0x70000n, 0); // outside B → hook
    install(A + 0x240, iat);

    const int = Buffer.alloc(16, 0);
    int.writeBigUInt64LE(0x2c0n, 0);
    install(A + 0x260, int);

    install(A + 0x2a0, Buffer.from('B.dll\0', 'ascii'));
    const hn = Buffer.alloc(258, 0);
    hn.writeUInt16LE(1, 0);
    hn.write('BareFunc\0', 2, 'ascii');
    install(A + 0x2c0, hn);

    // Module B: image WITHOUT an export directory (data dirs all zero).
    const B = 0x40000;
    installPeImage(B, []);

    (EnumProcessModules as any).mockReturnValueOnce({
      modules: [0x10n, 0x20n],
      count: 2,
    });
    (GetModuleBaseName as any).mockImplementation((_h: bigint, mod: bigint) =>
      mod === 0x10n ? 'A.exe' : 'B.dll',
    );
    (GetModuleInformation as any).mockImplementation((_h: bigint, mod: bigint) => ({
      success: true,
      info: {
        lpBaseOfDll: mod === 0x10n ? 0x10000n : 0x40000n,
        SizeOfImage: 0x2000,
        EntryPoint: 0x1000n,
      },
    }));

    const detections = await analyzer.detectIATHooks(1234, 'A.exe');
    expect(detections).toHaveLength(1);
    expect(detections[0]!.functionName).toBe('BareFunc');
    expect(detections[0]!.actualTarget).toBe('0x70000');
  });
});
