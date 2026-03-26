import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformMemoryAPI } from '@src/native/platform/PlatformMemoryAPI';
import {
  MemoryProtection,
  type ProcessHandle,
  type MemoryRegionInfo,
} from '@src/native/platform/types';

/** Build a mock PlatformMemoryAPI provider */
function createMockProvider(): PlatformMemoryAPI & {
  _queryRegionMock: ReturnType<typeof vi.fn>;
  _readMemoryMock: ReturnType<typeof vi.fn>;
  _openProcessMock: ReturnType<typeof vi.fn>;
  _closeProcessMock: ReturnType<typeof vi.fn>;
} {
  const openProcess = vi.fn(
    (_pid: number, _write: boolean): ProcessHandle => ({
      pid: _pid,
      writeAccess: _write,
    }),
  );
  const closeProcess = vi.fn();
  const queryRegion = vi.fn();
  const readMemory = vi.fn();

  return {
    platform: 'darwin',
    checkAvailability: vi.fn(async () => ({ available: true, platform: 'darwin' as const })),
    openProcess,
    closeProcess,
    readMemory,
    writeMemory: vi.fn(() => ({ bytesWritten: 0 })),
    queryRegion,
    changeProtection: vi.fn(() => ({ oldProtection: MemoryProtection.NoAccess })),
    allocateMemory: vi.fn(() => ({ address: 0n })),
    freeMemory: vi.fn(),
    enumerateModules: vi.fn(() => []),
    _queryRegionMock: queryRegion,
    _readMemoryMock: readMemory,
    _openProcessMock: openProcess,
    _closeProcessMock: closeProcess,
  };
}

const mockProvider = createMockProvider();

vi.mock('@src/native/platform/factory', () => ({
  createPlatformProvider: () => mockProvider,
}));

vi.mock('@native/NativeMemoryManager.availability', () => ({
  checkNativeMemoryAvailability: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { NativeMemoryManager, scanRegionInChunks } from '@src/native/NativeMemoryManager.impl';

function createChunkReader(source: Buffer, baseAddress = 0n) {
  return (address: bigint, size: number): Buffer => {
    const start = Number(address - baseAddress);
    return source.subarray(start, start + size);
  };
}

describe('NativeMemoryManager chunked scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches patterns that span chunk boundaries without duplicates', () => {
    const source = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xaa, 0xbb, 0xcc, 0xdd]);
    const matches = scanRegionInChunks(
      { baseAddress: 0n, regionSize: source.length },
      [0xaa, 0xbb, 0xcc, 0xdd],
      [1, 1, 1, 1],
      createChunkReader(source),
      3,
    );

    expect(matches).toEqual([0n, 4n]);
  });

  it('does not duplicate matches when overlap is zero', () => {
    const source = Buffer.from([0xaa, 0xaa, 0xaa]);
    const matches = scanRegionInChunks(
      { baseAddress: 0n, regionSize: source.length },
      [0xaa],
      [1],
      createChunkReader(source),
      1,
    );

    expect(matches).toEqual([0n, 1n, 2n]);
  });

  it('supports patterns longer than the chunk size', () => {
    const source = Buffer.from([1, 2, 3, 4, 5, 6]);
    const matches = scanRegionInChunks(
      { baseAddress: 0n, regionSize: source.length },
      [1, 2, 3, 4, 5],
      [1, 1, 1, 1, 1],
      createChunkReader(source),
      2,
    );

    expect(matches).toEqual([0n]);
  });

  it('scanMemory keeps large readable regions and reads them in chunks', async () => {
    // Use 64MB — big enough to require chunking (SCAN_CHUNK_SIZE = 16MB)
    // but small enough to not OOM the test worker
    const regionSize = 64 * 1024 * 1024;
    const regionInfo: MemoryRegionInfo = {
      baseAddress: 0n,
      size: regionSize,
      protection: MemoryProtection.ReadWrite,
      state: 'committed',
      type: 'private',
      isReadable: true,
      isWritable: true,
      isExecutable: false,
    };

    mockProvider._queryRegionMock.mockReturnValueOnce(regionInfo).mockReturnValueOnce(null); // end of regions

    // Return a small buffer with 0xAA pattern for each chunk read
    mockProvider._readMemoryMock.mockImplementation(
      (_handle: ProcessHandle, _addr: bigint, size: number) => ({
        data: Buffer.alloc(Math.min(size, 4096), 0xaa),
        bytesRead: Math.min(size, 4096),
      }),
    );

    const manager = new NativeMemoryManager();
    const result = await manager.scanMemory(42, 'AA', 'hex');

    expect(result.success).toBe(true);
    expect(mockProvider._readMemoryMock).toHaveBeenCalled();
    expect(mockProvider._readMemoryMock.mock.calls.length).toBeGreaterThan(1);
    expect(mockProvider._openProcessMock).toHaveBeenCalledTimes(1);
    expect(mockProvider._closeProcessMock).toHaveBeenCalledTimes(1);
  });
});
