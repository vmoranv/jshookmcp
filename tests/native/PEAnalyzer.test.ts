/**
 * PEAnalyzer — unit tests.
 *
 * Builds synthetic PE data in mock ReadProcessMemory to test header parsing,
 * section listing, import/export resolution, inline hook detection, and anomaly analysis.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Build Synthetic PE Data ──

function buildMockPE(): Buffer {
  const buf = Buffer.alloc(4096);

  // DOS Header
  buf.writeUInt16LE(0x5a4d, 0);   // e_magic = 'MZ'
  buf.writeUInt32LE(0x80, 60);     // e_lfanew = 128

  // NT Headers at offset 0x80
  buf.writeUInt32LE(0x00004550, 0x80);  // PE signature

  // File Header (20 bytes at 0x84)
  buf.writeUInt16LE(0x8664, 0x84);      // Machine = AMD64
  buf.writeUInt16LE(2, 0x86);            // NumberOfSections = 2
  buf.writeUInt32LE(0x60001234, 0x88);   // TimeDateStamp
  buf.writeUInt16LE(240, 0x94);          // SizeOfOptionalHeader (PE32+)
  buf.writeUInt16LE(0x22, 0x96);         // Characteristics (EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE)

  // Optional Header (PE32+) at 0x98
  buf.writeUInt16LE(0x20b, 0x98);        // Magic = PE32+
  buf.writeBigUInt64LE(0x140000000n, 0xb0); // ImageBase
  buf.writeUInt32LE(0x1000, 0xa8);       // AddressOfEntryPoint
  buf.writeUInt32LE(0x10000, 0xd8);      // SizeOfImage
  buf.writeUInt32LE(16, 0x104);           // NumberOfRvaAndSizes

  // Data Directories (at 0x108)
  // Export (dir 0): RVA=0x2000, Size=0x100
  buf.writeUInt32LE(0x2000, 0x108);
  buf.writeUInt32LE(0x100, 0x10c);
  // Import (dir 1): RVA=0x3000, Size=0x100
  buf.writeUInt32LE(0x3000, 0x110);
  buf.writeUInt32LE(0x100, 0x114);

  // Section Headers start at 0x80 + 4 + 20 + 240 = 0x188
  const secStart = 0x188;

  // Section 1: .text (executable)
  buf.write('.text\0\0\0', secStart, 'ascii');
  buf.writeUInt32LE(0x1000, secStart + 8);   // VirtualSize
  buf.writeUInt32LE(0x1000, secStart + 12);  // VirtualAddress
  buf.writeUInt32LE(0x800, secStart + 16);   // SizeOfRawData
  buf.writeUInt32LE(0x60000020, secStart + 36); // Characteristics: CODE|MEM_EXECUTE|MEM_READ

  // Section 2: .data (writable + executable — anomaly!)
  buf.write('.data\0\0\0', secStart + 40, 'ascii');
  buf.writeUInt32LE(0x500, secStart + 40 + 8);
  buf.writeUInt32LE(0x2000, secStart + 40 + 12);
  buf.writeUInt32LE(0x400, secStart + 40 + 16);
  buf.writeUInt32LE(0xe0000040, secStart + 40 + 36); // RWX anomaly: MEM_READ|MEM_WRITE|MEM_EXECUTE|INIT_DATA

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
  GetModuleInformation: vi.fn(() => ({
    success: true,
    info: { lpBaseOfDll: 0n, SizeOfImage: 4096, EntryPoint: 0x1000n },
  })),
}));

import { PEAnalyzer } from '@native/PEAnalyzer';
import { IMAGE_SCN } from '@native/PEAnalyzer.types';

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
      expect(headers.fileHeader.numberOfSections).toBe(2);
    });

    it('should throw for invalid DOS header', async () => {
      const { ReadProcessMemory } = await import('@native/Win32API');
      (ReadProcessMemory as ReturnType<typeof vi.fn>).mockReturnValueOnce(Buffer.alloc(64)); // No MZ
      await expect(analyzer.parseHeaders(1234, '0x0')).rejects.toThrow('Invalid DOS header');
    });
  });

  describe('listSections', () => {
    it('should return correct section count', async () => {
      const sections = await analyzer.listSections(1234, '0x0');
      expect(sections.length).toBe(2);
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
  });

  describe('analyzeSections', () => {
    it('should flag RWX section', async () => {
      const anomalies = await analyzer.analyzeSections(1234, '0x0');
      const rwx = anomalies.filter(a => a.anomalyType === 'rwx');
      expect(rwx.length).toBeGreaterThanOrEqual(1);
      expect(rwx[0]!.sectionName).toBe('.data');
      expect(rwx[0]!.severity).toBe('high');
    });

    it('should not flag normal .text section', async () => {
      const anomalies = await analyzer.analyzeSections(1234, '0x0');
      const textAnomalies = anomalies.filter(a => a.sectionName === '.text');
      expect(textAnomalies.length).toBe(0);
    });
  });

  describe('hook classification', () => {
    it('should classify JMP rel32 hook', () => {
      // Access private method via prototype trick
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0xe9; // JMP rel32
      buf.writeInt32LE(0x1000, 1);
      expect(p._classifyHook(buf)).toBe('jmp_rel32');
    });

    it('should classify JMP abs64 hook', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0xff;
      buf[1] = 0x25;
      expect(p._classifyHook(buf)).toBe('jmp_abs64');
    });

    it('should classify PUSH+RET hook', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const p = analyzer as any;
      const buf = Buffer.alloc(16);
      buf[0] = 0x68; // PUSH imm32
      buf[5] = 0xc3; // RET
      expect(p._classifyHook(buf)).toBe('push_ret');
    });

    it('should return unknown for unrecognized pattern', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const p = analyzer as any;
      const buf = Buffer.alloc(16, 0x90); // NOP sled
      expect(p._classifyHook(buf)).toBe('unknown');
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
});
