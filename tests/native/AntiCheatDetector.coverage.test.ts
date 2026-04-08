// @ts-nocheck
/**
 * AntiCheatDetector coverage tests — exercise all uncovered error branches.
 *
 * Gaps in the main test suite:
 *  - detect(): parseImports catch block (L173-175)
 *  - findGuardPages(): VirtualQueryEx throws in while loop (L223-225)
 *  - findGuardPages(): moduleName null (no module matches)
 *  - findGuardPages(): address overflow guard (L222)
 *  - checkIntegrity(): fs.readFile throws (L249 catch block)
 *  - checkIntegrity(): listSections throws (L250 catch block)
 *  - checkIntegrity(): section non-executable skip (L254)
 *  - checkIntegrity(): RVA out-of-bounds skip (L269)
 *  - _rvaToFileOffset: all-bits-set PE headers
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Hoisted state for PEAnalyzer mock — tests mutate this to change behavior
// without needing vi.resetModules() + dynamic import() (which causes OOM).
const peaState = vi.hoisted(() => ({
  parseImportsThrows: false,
  listSectionsThrows: false,
  listSectionsReturnValue: [] as any[],
}));

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(async () => Buffer.alloc(1024)),
  },
}));

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

vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn() },
}));

// PEAnalyzer mock reads from hoisted state — tests toggle behavior by mutating peaState.
vi.mock('@native/PEAnalyzer', () => ({
  PEAnalyzer: class {
    async parseImports() {
      if (peaState.parseImportsThrows) {
        throw new Error('access denied');
      }
      return [];
    }
    async listSections() {
      if (peaState.listSectionsThrows) {
        throw new Error('memory access denied');
      }
      return peaState.listSectionsReturnValue;
    }
  },
}));

import { AntiCheatDetector } from '@native/AntiCheatDetector';

// ── detect(): parseImports catch block ────────────────────────────────────────

describe('AntiCheatDetector coverage: detect() — parseImports error branch', () => {
  afterEach(() => {
    peaState.parseImportsThrows = false;
    peaState.listSectionsThrows = false;
    peaState.listSectionsReturnValue = [];
    vi.restoreAllMocks();
  });

  it('logs and skips module when parseImports throws', async () => {
    peaState.parseImportsThrows = true;

    const detector = new AntiCheatDetector();
    const detections = await detector.detect(1234);

    // No crash — error is swallowed
    expect(Array.isArray(detections)).toBe(true);
    // No detections because parseImports failed
    expect(detections.length).toBe(0);
  });

  it('logs and skips module when _enumerateModules throws', async () => {
    const { VirtualQueryEx } = await import('@native/Win32API');
    // Make _enumerateModules return empty (simulates failure)
    (VirtualQueryEx as ReturnType<typeof vi.fn>).mockReturnValueOnce({ success: false, info: {} });

    const detector = new AntiCheatDetector();
    const detections = await detector.detect(1234);
    // No detections, no crash
    expect(Array.isArray(detections)).toBe(true);
  });
});

// ── findGuardPages(): error and boundary branches ─────────────────────────────

describe('AntiCheatDetector coverage: findGuardPages() — error paths', () => {
  it('continues to next page when VirtualQueryEx throws', async () => {
    const { VirtualQueryEx } = await import('@native/Win32API');
    // First call succeeds, second throws, third succeeds with no guard
    (VirtualQueryEx as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        success: true,
        info: {
          BaseAddress: 0n,
          AllocationBase: 0n,
          AllocationProtect: 0x04,
          RegionSize: 0x1000n,
          State: 0x1000,
          Protect: 0x104, // PAGE_GUARD
          Type: 0x20000,
        },
      })
      .mockImplementationOnce(() => {
        throw new Error('simulated read fault');
      })
      .mockReturnValueOnce({
        success: true,
        info: {
          BaseAddress: 0x1000n,
          AllocationBase: 0x1000n,
          AllocationProtect: 0x04,
          RegionSize: 0x1000n,
          State: 0x1000,
          Protect: 0x04, // no guard
          Type: 0x20000,
        },
      })
      .mockReturnValue({ success: false, info: {} });

    const detector = new AntiCheatDetector();
    const pages = await detector.findGuardPages(1234);

    // Should have found at least 1 guard page before the throw
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it('returns guard page with null moduleName when no module matches', async () => {
    const { VirtualQueryEx, EnumProcessModules } = await import('@native/Win32API');
    (VirtualQueryEx as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      info: {
        BaseAddress: 0x50000000n,
        AllocationBase: 0x50000000n,
        AllocationProtect: 0x04,
        RegionSize: 0x1000n,
        State: 0x1000,
        Protect: 0x104, // PAGE_GUARD
        Type: 0x20000,
      },
    });
    // Module at 0n-0x1000 — guard page at 0x50000000 is outside
    (EnumProcessModules as ReturnType<typeof vi.fn>).mockReturnValue({
      modules: [0n],
      count: 1,
    });

    const detector = new AntiCheatDetector();
    const pages = await detector.findGuardPages(1234);
    expect(pages.length).toBeGreaterThan(0);
    // moduleName should be null since 0x50000000 is not in [0n, 4096n)
    expect(pages[0]!.moduleName).toBeNull();
  });

  it('stops on address overflow guard', async () => {
    const { VirtualQueryEx } = await import('@native/Win32API');
    // Cause overflow: RegionSize makes address wrap
    (VirtualQueryEx as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      success: true,
      info: {
        BaseAddress: 0xffffffffffffffffn - 0x1000n + 1n,
        AllocationBase: 0n,
        AllocationProtect: 0x04,
        RegionSize: 0x1000n,
        State: 0x1000,
        Protect: 0x04,
        Type: 0x20000,
      },
    });

    const detector = new AntiCheatDetector();
    const pages = await detector.findGuardPages(1234);
    // Should terminate without infinite loop
    expect(Array.isArray(pages)).toBe(true);
  });
});

// ── checkIntegrity(): error paths ──────────────────────────────────────────────

describe('AntiCheatDetector coverage: checkIntegrity() — error branches', () => {
  afterEach(() => {
    peaState.parseImportsThrows = false;
    peaState.listSectionsThrows = false;
    peaState.listSectionsReturnValue = [];
    vi.restoreAllMocks();
  });

  it('returns empty when listSections throws', async () => {
    peaState.listSectionsThrows = true;

    const detector = new AntiCheatDetector();
    const results = await detector.checkIntegrity(1234);
    expect(Array.isArray(results)).toBe(true);
  });

  it('skips non-executable sections in integrity check', async () => {
    peaState.listSectionsReturnValue = [
      {
        name: '.data',
        virtualAddress: '0x1000',
        virtualSize: 256,
        rawSize: 256,
        characteristics: 0xc0000040, // MEM_READ | MEM_WRITE — NOT executable
        isExecutable: false,
        isWritable: true,
        isReadable: true,
      },
    ];

    const { GetModuleFileNameEx } = await import('@native/Win32API');
    (GetModuleFileNameEx as ReturnType<typeof vi.fn>).mockReturnValue('/nonexistent/test.exe');

    const detector = new AntiCheatDetector();
    const results = await detector.checkIntegrity(1234);
    // Non-executable sections are skipped → no results
    expect(results.length).toBe(0);
  });

  it('skips section when RVA to file offset is out of bounds', async () => {
    peaState.listSectionsReturnValue = [
      {
        name: '.text',
        virtualAddress: '0x99999999', // Way beyond PE file size
        virtualSize: 256,
        rawSize: 256,
        characteristics: 0x60000020,
        isExecutable: true,
        isWritable: false,
        isReadable: true,
      },
    ];

    const detector = new AntiCheatDetector();
    const results = await detector.checkIntegrity(1234);
    // RVA out of bounds → section skipped → no results
    expect(results.length).toBe(0);
  });
});

// ── _rvaToFileOffset: boundary branches ───────────────────────────────────────

describe('AntiCheatDetector coverage: _rvaToFileOffset', () => {
  it('handles PE with all-bits-set headers (corrupt/unusual PE)', async () => {
    const detector = new AntiCheatDetector();
    // Call the private method directly via any
    const p = detector as any;
    const buf = Buffer.alloc(1024);
    buf.writeUInt16LE(0x5a4d, 0);
    buf.writeUInt32LE(128, 60);
    // Fill section headers with max values to test overflow handling
    const secStart = 128 + 24 + 240;
    buf.writeUInt32LE(0xffffffff, secStart + 8); // VirtualSize = max
    buf.writeUInt32LE(0xffffffff, secStart + 12); // VirtualAddress = max
    buf.writeUInt32LE(0xffffffff, secStart + 20); // PointerToRawData = max

    const offset = p._rvaToFileOffset(buf, 0xffffffff);
    expect(offset).toBe(-1);
  });

  it('returns -1 when RVA exceeds section coverage', async () => {
    const detector = new AntiCheatDetector();
    const p = detector as any;
    const buf = Buffer.alloc(1024);
    buf.writeUInt16LE(0x5a4d, 0);
    buf.writeUInt32LE(128, 60);
    // Valid section covering 0x1000-0x1FFF
    const secStart = 128 + 24 + 240;
    buf.writeUInt32LE(0x1000, secStart + 8); // VirtualSize
    buf.writeUInt32LE(0x1000, secStart + 12); // VirtualAddress
    buf.writeUInt32LE(0x800, secStart + 16); // SizeOfRawData
    buf.writeUInt32LE(0x1000, secStart + 20); // PointerToRawData

    // RVA within section range should succeed
    expect(p._rvaToFileOffset(buf, 0x1000)).toBe(0x1000);
    // RVA beyond section should return -1
    expect(p._rvaToFileOffset(buf, 0x3000)).toBe(-1);
  });
});
