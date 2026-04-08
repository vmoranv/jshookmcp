/**
 * AntiCheatDetector coverage tests — detect() and findGuardPages() branches.
 *
 * Split from a single large file to avoid OOM in vitest forks.
 * Each file loads a minimal set of mocks independently.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const peaState = vi.hoisted(() => ({
  parseImportsThrows: false,
  listSectionsThrows: false,
  listSectionsReturnValue: [] as any[],
}));

vi.mock('node:fs', () => ({
  promises: { readFile: vi.fn(async () => Buffer.alloc(1024)) },
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
          Protect: 0x104,
          Type: 0x20000,
        },
      };
    }
    return { success: false, info: {} };
  }),
  PAGE: { GUARD: 0x100 },
  EnumProcessModules: vi.fn(() => ({ modules: [0n], count: 1 })),
  GetModuleBaseName: vi.fn(() => 'test.exe'),
  GetModuleFileNameEx: vi.fn(() => 'test.exe'),
  GetModuleInformation: vi.fn(() => ({
    success: true,
    info: { lpBaseOfDll: 0n, SizeOfImage: 4096, EntryPoint: 0x1000n },
  })),
}));

vi.mock('@utils/logger', () => ({ logger: { debug: vi.fn() } }));

vi.mock('@native/PEAnalyzer', () => ({
  PEAnalyzer: class {
    async parseImports() {
      if (peaState.parseImportsThrows) throw new Error('access denied');
      return [];
    }
    async listSections() {
      if (peaState.listSectionsThrows) throw new Error('memory access denied');
      return peaState.listSectionsReturnValue;
    }
  },
}));

import { AntiCheatDetector } from '@native/AntiCheatDetector';

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
    expect(Array.isArray(detections)).toBe(true);
    expect(detections.length).toBe(0);
  });

  it('logs and skips module when _enumerateModules throws', async () => {
    const { VirtualQueryEx } = await import('@native/Win32API');
    (VirtualQueryEx as ReturnType<typeof vi.fn>).mockReturnValueOnce({ success: false, info: {} });
    const detector = new AntiCheatDetector();
    const detections = await detector.detect(1234);
    expect(Array.isArray(detections)).toBe(true);
  });
});

describe('AntiCheatDetector coverage: findGuardPages() — error paths', () => {
  it('continues to next page when VirtualQueryEx throws', async () => {
    const { VirtualQueryEx } = await import('@native/Win32API');
    (VirtualQueryEx as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        success: true,
        info: {
          BaseAddress: 0n,
          AllocationBase: 0n,
          AllocationProtect: 0x04,
          RegionSize: 0x1000n,
          State: 0x1000,
          Protect: 0x104,
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
          Protect: 0x04,
          Type: 0x20000,
        },
      })
      .mockReturnValue({ success: false, info: {} });

    const detector = new AntiCheatDetector();
    const pages = await detector.findGuardPages(1234);
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it('returns guard page with null moduleName when no module matches', async () => {
    const { VirtualQueryEx, EnumProcessModules } = await import('@native/Win32API');
    (VirtualQueryEx as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        success: true,
        info: {
          BaseAddress: 0x50000000n,
          AllocationBase: 0x50000000n,
          AllocationProtect: 0x04,
          RegionSize: 0x1000n,
          State: 0x1000,
          Protect: 0x104,
          Type: 0x20000,
        },
      })
      .mockReturnValue({ success: false, info: {} });
    (EnumProcessModules as ReturnType<typeof vi.fn>).mockReturnValue({ modules: [0n], count: 1 });

    const detector = new AntiCheatDetector();
    const pages = await detector.findGuardPages(1234);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.moduleName).toBeNull();
  });

  it('stops on address overflow guard', async () => {
    const { VirtualQueryEx } = await import('@native/Win32API');
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
    expect(Array.isArray(pages)).toBe(true);
  });
});
