/**
 * AntiCheatDetector coverage tests — checkIntegrity() branches + _rvaToFileOffset.
 *
 * Split from a single large file to avoid OOM in vitest forks.
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
  VirtualQueryEx: vi.fn(() => ({ success: false, info: {} })),
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
        characteristics: 0xc0000040,
        isExecutable: false,
        isWritable: true,
        isReadable: true,
      },
    ];

    const { GetModuleFileNameEx } = await import('@native/Win32API');
    (GetModuleFileNameEx as ReturnType<typeof vi.fn>).mockReturnValue('/nonexistent/test.exe');

    const detector = new AntiCheatDetector();
    const results = await detector.checkIntegrity(1234);
    expect(results.length).toBe(0);
  });

  it('skips section when RVA to file offset is out of bounds', async () => {
    peaState.listSectionsReturnValue = [
      {
        name: '.text',
        virtualAddress: '0x99999999',
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
    expect(results.length).toBe(0);
  });
});

describe('AntiCheatDetector coverage: _rvaToFileOffset', () => {
  it('handles PE with all-bits-set headers (corrupt/unusual PE)', async () => {
    const detector = new AntiCheatDetector();
    const p = detector as any;
    const buf = Buffer.alloc(1024);
    buf.writeUInt16LE(0x5a4d, 0);
    buf.writeUInt32LE(128, 60);
    const secStart = 128 + 24 + 240;
    buf.writeUInt32LE(0xffffffff, secStart + 8);
    buf.writeUInt32LE(0xffffffff, secStart + 12);
    buf.writeUInt32LE(0xffffffff, secStart + 20);

    const offset = p._rvaToFileOffset(buf, 0xffffffff);
    expect(offset).toBe(-1);
  });

  it('returns -1 when RVA exceeds section coverage', async () => {
    const detector = new AntiCheatDetector();
    const p = detector as any;
    const buf = Buffer.alloc(1024);
    buf.writeUInt16LE(0x5a4d, 0);
    buf.writeUInt32LE(128, 60);

    // RVA way beyond anything in the buffer should always return -1
    expect(p._rvaToFileOffset(buf, 0x3000)).toBe(-1);
    expect(p._rvaToFileOffset(buf, 0xdeadbeef)).toBe(-1);
  });
});
