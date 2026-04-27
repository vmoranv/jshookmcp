/**
 * AntiCheatDetector — unit tests.
 *
 * Mocks Win32 APIs and PEAnalyzer to test anti-debug detection,
 * guard page finding, and integrity checking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: {
    readFile: state.readFile,
  },
}));

// Mock imports for anti-debug detection
const mockImports = [
  {
    dllName: 'KERNEL32.dll',
    functions: [
      { name: 'IsDebuggerPresent', ordinal: 0, hint: 0, thunkRva: '0x1000' },
      { name: 'GetTickCount64', ordinal: 0, hint: 0, thunkRva: '0x1008' },
      { name: 'ReadFile', ordinal: 0, hint: 0, thunkRva: '0x1010' },
    ],
  },
  {
    dllName: 'ntdll.dll',
    functions: [
      { name: 'NtQueryInformationProcess', ordinal: 0, hint: 0, thunkRva: '0x2000' },
      { name: 'NtSetInformationThread', ordinal: 0, hint: 0, thunkRva: '0x2008' },
    ],
  },
  {
    dllName: 'USER32.dll',
    functions: [{ name: 'GetThreadContext', ordinal: 0, hint: 0, thunkRva: '0x3000' }],
  },
];

const originalImports = JSON.parse(JSON.stringify(mockImports));

function buildPeImage(sectionBytes: Buffer): Buffer {
  const rawOffset = 0x200;
  const pe = Buffer.alloc(rawOffset + sectionBytes.length);
  const peHeaderOffset = 0x80;
  const sectionTableOffset = peHeaderOffset + 24 + 0xe0;

  pe.writeUInt32LE(peHeaderOffset, 60);
  pe.writeUInt16LE(1, peHeaderOffset + 6);
  pe.writeUInt16LE(0xe0, peHeaderOffset + 20);
  pe.writeUInt32LE(sectionBytes.length, sectionTableOffset + 8);
  pe.writeUInt32LE(0x1000, sectionTableOffset + 12);
  pe.writeUInt32LE(rawOffset, sectionTableOffset + 20);
  sectionBytes.copy(pe, rawOffset);

  return pe;
}

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: vi.fn(() => 1n),
  CloseHandle: vi.fn(() => true),
  ReadProcessMemory: vi.fn((_h: bigint, _a: bigint, size: number) => Buffer.alloc(size)),
  VirtualQueryEx: vi.fn((_h: bigint, addr: bigint) => {
    if (addr < 0x10000n) {
      return {
        success: true,
        info: {
          BaseAddress: addr,
          AllocationBase: addr,
          AllocationProtect: 0x04,
          RegionSize: 0x1000n,
          State: 0x1000,
          Protect: 0x104, // PAGE_READWRITE | PAGE_GUARD
          Type: 0x20000,
        },
      };
    }
    return { success: false, info: {} };
  }),
  PAGE: { GUARD: 0x100 },
  EnumProcessModules: vi.fn(() => ({
    modules: [0n],
    count: 1,
  })),
  GetModuleBaseName: vi.fn(() => 'test.exe'),
  GetModuleFileNameEx: vi.fn(() => 'test.exe'),
  GetModuleInformation: vi.fn(() => ({
    success: true,
    info: { lpBaseOfDll: 0n, SizeOfImage: 4096, EntryPoint: 0x1000n },
  })),
}));

vi.mock('@native/PEAnalyzer', () => ({
  PEAnalyzer: class {
    async parseImports() {
      return mockImports;
    }
    async listSections() {
      return [
        {
          name: '.text',
          virtualAddress: '0x1000',
          virtualSize: 256,
          rawSize: 256,
          characteristics: 0x60000020,
          isExecutable: true,
          isWritable: false,
          isReadable: true,
        },
      ];
    }
  },
}));

import { AntiCheatDetector } from '@native/AntiCheatDetector';

describe('AntiCheatDetector', () => {
  let detector: AntiCheatDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new AntiCheatDetector();
    mockImports.splice(0, mockImports.length, ...JSON.parse(JSON.stringify(originalImports)));
    state.readFile.mockRejectedValue(new Error('ENOENT'));
  });

  describe('detect', () => {
    it('should detect IsDebuggerPresent import', async () => {
      const detections = await detector.detect(1234);
      const isDbg = detections.find((d) => d.details.includes('IsDebuggerPresent'));
      expect(isDbg).toBeDefined();
      expect(isDbg!.mechanism).toBe('anti_debug_api');
      expect(isDbg!.confidence).toBe('high');
    });

    it('should detect NtQueryInformationProcess import', async () => {
      const detections = await detector.detect(1234);
      const nqip = detections.find((d) => d.details.includes('NtQueryInformationProcess'));
      expect(nqip).toBeDefined();
      expect(nqip!.mechanism).toBe('ntquery_debug');
    });

    it('should detect NtSetInformationThread for thread hiding', async () => {
      const detections = await detector.detect(1234);
      const nsit = detections.find((d) => d.details.includes('NtSetInformationThread'));
      expect(nsit).toBeDefined();
      expect(nsit!.mechanism).toBe('thread_hiding');
    });

    it('should detect GetThreadContext for DR register checks', async () => {
      const detections = await detector.detect(1234);
      const gtc = detections.find((d) => d.details.includes('GetThreadContext'));
      expect(gtc).toBeDefined();
      expect(gtc!.mechanism).toBe('hardware_breakpoint');
    });

    it('should detect timing check imports', async () => {
      const detections = await detector.detect(1234);
      const timing = detections.filter((d) => d.mechanism === 'timing_check');
      expect(timing.length).toBeGreaterThanOrEqual(1);
    });

    it('should include non-empty bypassSuggestion for all detections', async () => {
      const detections = await detector.detect(1234);
      for (const d of detections) {
        expect(d.bypassSuggestion).toBeTruthy();
        expect(d.bypassSuggestion.length).toBeGreaterThan(10);
      }
    });

    it('should include moduleName in all detections', async () => {
      const detections = await detector.detect(1234);
      for (const d of detections) {
        expect(d.moduleName).toBe('test.exe');
      }
    });

    it('should not flag benign imports like ReadFile', async () => {
      const detections = await detector.detect(1234);
      const readFile = detections.find((d) => d.details.includes('ReadFile'));
      expect(readFile).toBeUndefined();
    });

    it('skips modules whose import parsing fails', async () => {
      (detector as any).peAnalyzer.parseImports = vi
        .fn()
        .mockRejectedValue(new Error('bad imports'));

      await expect(detector.detect(1234)).resolves.toEqual([]);
    });
  });

  describe('findGuardPages', () => {
    it('should find guard page regions', async () => {
      const pages = await detector.findGuardPages(1234);
      expect(pages.length).toBeGreaterThanOrEqual(1);
      expect(pages[0]!.address).toBeDefined();
      expect(pages[0]!.size).toBe(0x1000);
    });

    it('should return empty when no guard pages', async () => {
      const { VirtualQueryEx } = await import('@native/Win32API');
      (VirtualQueryEx as ReturnType<typeof vi.fn>).mockReturnValue({ success: false, info: {} });
      const pages = await detector.findGuardPages(1234);
      expect(pages.length).toBe(0);
    });

    it('skips readable regions that are not marked as guard pages', async () => {
      const { VirtualQueryEx } = await import('@native/Win32API');
      (VirtualQueryEx as ReturnType<typeof vi.fn>).mockImplementation(
        (_h: bigint, addr: bigint) => {
          if (addr === 0n) {
            return {
              success: true,
              info: {
                BaseAddress: 0n,
                AllocationBase: 0n,
                AllocationProtect: 0x04,
                RegionSize: 0x1000n,
                State: 0x1000,
                Protect: 0x04,
                Type: 0x20000,
              },
            };
          }
          return { success: false, info: {} };
        },
      );

      const pages = await detector.findGuardPages(1234);
      expect(pages).toEqual([]);
    });

    it('continues scanning after transient VirtualQueryEx failures', async () => {
      const { VirtualQueryEx } = await import('@native/Win32API');
      (VirtualQueryEx as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error('temporary page query failure');
        })
        .mockImplementation((_h: bigint, addr: bigint) => {
          if (addr < 0x10000n) {
            return {
              success: true,
              info: {
                BaseAddress: addr,
                AllocationBase: addr,
                AllocationProtect: 0x04,
                RegionSize: 0x1000n,
                State: 0x1000,
                Protect: 0x104,
                Type: 0x20000,
              },
            };
          }
          return { success: false, info: {} };
        });

      const pages = await detector.findGuardPages(1234);
      expect(pages.length).toBeGreaterThan(0);
    });

    it('stops when VirtualQueryEx would not advance the scan window', async () => {
      const { VirtualQueryEx } = await import('@native/Win32API');
      (VirtualQueryEx as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        info: {
          BaseAddress: 0n,
          AllocationBase: 0n,
          AllocationProtect: 0x04,
          RegionSize: 0n,
          State: 0x1000,
          Protect: 0x04,
          Type: 0x20000,
        },
      });

      const pages = await detector.findGuardPages(1234);
      expect(pages).toEqual([]);
    });

    it('returns partial results when the configured region cap is hit', async () => {
      const cappedDetector = new AntiCheatDetector({
        guardPageMaxRegions: 1,
        guardPageTimeoutMs: 10_000,
      });

      const result = await cappedDetector.scanGuardPages(1234);

      expect(result.guardPages).toHaveLength(1);
      expect(result.stats.scannedRegions).toBe(1);
      expect(result.stats.truncated).toBe(true);
      expect(result.stats.timedOut).toBe(false);
    });
  });

  describe('checkIntegrity', () => {
    it('should return integrity info for executable sections', async () => {
      const results = await detector.checkIntegrity(1234);
      // May return empty if file can't be read, but should not throw
      expect(Array.isArray(results)).toBe(true);
    });

    it('hashes executable sections and reports modified memory', async () => {
      const diskBytes = Buffer.alloc(16, 0x41);
      const memoryBytes = Buffer.alloc(16, 0x42);
      state.readFile.mockResolvedValue(buildPeImage(diskBytes));
      (detector as any).peAnalyzer.listSections = vi.fn().mockResolvedValue([
        {
          name: '.text',
          virtualAddress: '0x1000',
          virtualSize: 16,
          rawSize: 16,
          characteristics: 0x60000020,
          isExecutable: true,
          isWritable: false,
          isReadable: true,
        },
      ]);

      const { ReadProcessMemory } = await import('@native/Win32API');
      (ReadProcessMemory as ReturnType<typeof vi.fn>).mockReturnValue(memoryBytes);

      const results = await detector.checkIntegrity(1234, 'test');

      expect(results).toEqual([
        expect.objectContaining({
          sectionName: '.text',
          moduleName: 'test.exe',
          isModified: true,
        }),
      ]);
    });

    it('skips non-executable, zero-sized, and unmappable sections', async () => {
      state.readFile.mockResolvedValue(buildPeImage(Buffer.alloc(16, 0x11)));
      (detector as any).peAnalyzer.listSections = vi.fn().mockResolvedValue([
        {
          name: '.rdata',
          virtualAddress: '0x1000',
          virtualSize: 16,
          rawSize: 16,
          characteristics: 0x40000040,
          isExecutable: false,
          isWritable: false,
          isReadable: true,
        },
        {
          name: '.text',
          virtualAddress: '0x1000',
          virtualSize: 0,
          rawSize: 0,
          characteristics: 0x60000020,
          isExecutable: true,
          isWritable: false,
          isReadable: true,
        },
        {
          name: '.patch',
          virtualAddress: '0x3000',
          virtualSize: 16,
          rawSize: 16,
          characteristics: 0x60000020,
          isExecutable: true,
          isWritable: false,
          isReadable: true,
        },
      ]);

      const { ReadProcessMemory } = await import('@native/Win32API');
      (ReadProcessMemory as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.alloc(16, 0x22));

      const results = await detector.checkIntegrity(1234);

      expect(results).toEqual([]);
      expect(ReadProcessMemory).toHaveBeenCalledTimes(1);
    });

    it('returns partial integrity results when the byte budget is exhausted', async () => {
      const budgetedDetector = new AntiCheatDetector({
        integrityMaxBytes: 12,
        integrityTimeoutMs: 10_000,
      });
      state.readFile.mockResolvedValue(buildPeImage(Buffer.alloc(32, 0x41)));
      (budgetedDetector as any).peAnalyzer.listSections = vi.fn().mockResolvedValue([
        {
          name: '.text',
          virtualAddress: '0x1000',
          virtualSize: 8,
          rawSize: 8,
          characteristics: 0x60000020,
          isExecutable: true,
          isWritable: false,
          isReadable: true,
        },
        {
          name: '.text2',
          virtualAddress: '0x1010',
          virtualSize: 8,
          rawSize: 8,
          characteristics: 0x60000020,
          isExecutable: true,
          isWritable: false,
          isReadable: true,
        },
      ]);

      const { ReadProcessMemory } = await import('@native/Win32API');
      (ReadProcessMemory as ReturnType<typeof vi.fn>).mockImplementation(
        (_h: bigint, _a: bigint, size: number) => Buffer.alloc(size, 0x41),
      );

      const result = await budgetedDetector.scanIntegrity(1234);

      expect(result.sections).toHaveLength(1);
      expect(result.stats.scannedSections).toBe(1);
      expect(result.stats.hashedBytes).toBe(8);
      expect(result.stats.truncated).toBe(true);
      expect(result.stats.timedOut).toBe(false);
    });
  });

  it('returns no detections for benign imports and resolves RVAs to file offsets', async () => {
    mockImports.splice(0, mockImports.length, {
      dllName: 'KERNEL32.dll',
      functions: [{ name: 'ReadFile', ordinal: 0, hint: 0, thunkRva: '0x1000' }],
    });

    const detections = await detector.detect(1234);
    expect(detections).toEqual([]);

    const pe = Buffer.alloc(512);
    pe.writeUInt32LE(128, 60);
    pe.writeUInt16LE(1, 128 + 6);
    pe.writeUInt16LE(0xe0, 128 + 20);

    const secStart = 128 + 24 + 0xe0;
    pe.writeUInt32LE(0x1000, secStart + 12);
    pe.writeUInt32LE(0x200, secStart + 8);
    pe.writeUInt32LE(0x400, secStart + 20);

    expect((detector as any)._rvaToFileOffset(pe, 0x1100)).toBe(0x500);
    expect((detector as any)._rvaToFileOffset(pe, 0x3000)).toBe(-1);
  });

  it('gracefully handles module enumeration failures', async () => {
    const { EnumProcessModules } = await import('@native/Win32API');
    (EnumProcessModules as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('enumeration failed');
    });

    await expect(detector.detect(1234)).resolves.toEqual([]);
  });

  it('falls back to module names and skips modules without metadata', async () => {
    const { EnumProcessModules, GetModuleBaseName, GetModuleFileNameEx, GetModuleInformation } =
      await import('@native/Win32API');
    (EnumProcessModules as ReturnType<typeof vi.fn>).mockReturnValue({
      modules: [0x1000n, 0x2000n],
      count: 2,
    });
    (GetModuleBaseName as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('first.dll')
      .mockReturnValueOnce('second.dll');
    (GetModuleFileNameEx as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('C:\\second.dll');
    (GetModuleInformation as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ success: true, info: { lpBaseOfDll: 0x1000n, SizeOfImage: 1234 } })
      .mockReturnValueOnce({ success: false, info: { lpBaseOfDll: 0x2000n, SizeOfImage: 4321 } });

    const modules = (detector as any)._enumerateModules(1n);

    expect(modules).toEqual([
      expect.objectContaining({
        name: 'first.dll',
        path: 'first.dll',
      }),
    ]);
  });

  it('returns -1 when the section table is truncated', () => {
    const pe = Buffer.alloc(128);
    pe.writeUInt32LE(80, 60);
    pe.writeUInt16LE(1, 80 + 6);
    pe.writeUInt16LE(0xe0, 80 + 20);

    expect((detector as any)._rvaToFileOffset(pe, 0x1000)).toBe(-1);
  });
});
