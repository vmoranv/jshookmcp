/**
 * AntiCheatDetector — unit tests.
 *
 * Mocks Win32 APIs and PEAnalyzer to test anti-debug detection,
 * guard page finding, and integrity checking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    detector = new AntiCheatDetector();
    mockImports.splice(0, mockImports.length, ...JSON.parse(JSON.stringify(originalImports)));
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
  });

  describe('checkIntegrity', () => {
    it('should return integrity info for executable sections', async () => {
      const results = await detector.checkIntegrity(1234);
      // May return empty if file can't be read, but should not throw
      expect(Array.isArray(results)).toBe(true);
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
});
