import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  readMemory: vi.fn(),
  writeMemory: vi.fn(),
  batchMemoryWrite: vi.fn(),
  scanMemory: vi.fn(),
  scanMemoryFiltered: vi.fn(),
  dumpMemoryRegion: vi.fn(),
  enumerateRegions: vi.fn(),
  checkMemoryProtection: vi.fn(),
  enumerateModules: vi.fn(),
  injectDll: vi.fn(),
  injectShellcode: vi.fn(),
  checkAvailability: vi.fn(),
  checkDebugPort: vi.fn(),
  monitorStart: vi.fn(() => 'monitor-id'),
  monitorStop: vi.fn(() => true),
}));

vi.mock('../../../src/modules/process/memory/index.js', () => ({
  readMemory: state.readMemory,
  writeMemory: state.writeMemory,
  batchMemoryWrite: state.batchMemoryWrite,
  scanMemory: state.scanMemory,
  scanMemoryFiltered: state.scanMemoryFiltered,
  dumpMemoryRegion: state.dumpMemoryRegion,
  enumerateRegions: state.enumerateRegions,
  checkMemoryProtection: state.checkMemoryProtection,
  enumerateModules: state.enumerateModules,
  injectDll: state.injectDll,
  injectShellcode: state.injectShellcode,
  checkAvailability: state.checkAvailability,
  checkDebugPort: state.checkDebugPort,
  MemoryMonitorManager: class {
    start = state.monitorStart;
    stop = state.monitorStop;
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { MemoryManager } from '../../../src/modules/process/MemoryManager.js';

function currentPlatform(): 'win32' | 'linux' | 'darwin' | 'unknown' {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'darwin') return 'darwin';
  return 'unknown';
}

describe('MemoryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates readMemory with platform and protection callback', async () => {
    state.checkMemoryProtection.mockResolvedValue({ success: true, isReadable: true });
    state.readMemory.mockImplementation(
      async (
        platform: string,
        pid: number,
        address: string,
        size: number,
        checkFn: (pid: number, address: string) => Promise<unknown>
      ) => {
        expect(platform).toBe(currentPlatform());
        expect(pid).toBe(123);
        expect(address).toBe('0x10');
        expect(size).toBe(8);
        await checkFn(123, '0x10');
        return { success: true, data: 'AA' };
      }
    );

    const manager = new MemoryManager();
    const result = await manager.readMemory(123, '0x10', 8);

    expect(result.success).toBe(true);
    expect(state.checkMemoryProtection).toHaveBeenCalledWith(currentPlatform(), 123, '0x10');
  });

  it('delegates writeMemory and preserves encoding argument', async () => {
    state.writeMemory.mockResolvedValue({ success: true, bytesWritten: 4 });
    const manager = new MemoryManager();
    await manager.writeMemory(1, '0x20', 'DE AD BE EF', 'hex');

    expect(state.writeMemory).toHaveBeenCalledWith(
      currentPlatform(),
      1,
      '0x20',
      'DE AD BE EF',
      'hex',
      expect.any(Function)
    );
  });

  it('delegates scanMemoryFiltered with read/scan callbacks', async () => {
    state.readMemory.mockResolvedValue({ success: true, data: 'AB CD' });
    state.scanMemory.mockResolvedValue({ success: true, addresses: ['0x100'] });
    state.scanMemoryFiltered.mockImplementation(
      async (
        _pid: number,
        _pattern: string,
        _addresses: string[],
        _patternType: string,
        readFn: (pid: number, address: string, size: number) => Promise<unknown>,
        scanFn: (pid: number, pattern: string, patternType: any) => Promise<unknown>
      ) => {
        await readFn(9, '0x99', 4);
        await scanFn(9, 'AA', 'hex');
        return { success: true, addresses: ['0x99'] };
      }
    );

    const manager = new MemoryManager();
    const result = await manager.scanMemoryFiltered(9, 'AA', ['0x99'], 'hex');

    expect(result.success).toBe(true);
    expect(state.scanMemoryFiltered).toHaveBeenCalled();
    expect(state.readMemory).toHaveBeenCalled();
    expect(state.scanMemory).toHaveBeenCalled();
  });

  it('delegates monitor start/stop to MemoryMonitorManager instance', () => {
    const manager = new MemoryManager();
    const onChange = vi.fn();

    const monitorId = manager.startMemoryMonitor(10, '0x1234', 4, 200, onChange);
    const stopped = manager.stopMemoryMonitor(monitorId);

    expect(monitorId).toBe('monitor-id');
    expect(state.monitorStart).toHaveBeenCalledWith(
      10,
      '0x1234',
      4,
      200,
      expect.any(Function),
      onChange
    );
    expect(stopped).toBe(true);
    expect(state.monitorStop).toHaveBeenCalledWith('monitor-id');
  });

  it('delegates availability and debug checks', async () => {
    state.checkAvailability.mockResolvedValue({ available: true });
    state.checkDebugPort.mockResolvedValue({ success: true, isDebugged: false });
    const manager = new MemoryManager();

    const availability = await manager.checkAvailability();
    const debugState = await manager.checkDebugPort(100);

    expect(availability.available).toBe(true);
    expect(debugState.isDebugged).toBe(false);
    expect(state.checkAvailability).toHaveBeenCalledWith(currentPlatform());
    expect(state.checkDebugPort).toHaveBeenCalledWith(currentPlatform(), 100);
  });
});

