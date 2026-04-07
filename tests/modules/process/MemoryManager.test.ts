import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../../src/modules/process/MemoryManager';

// Mock the internal sub-module delegates
vi.mock('@modules/process/memory/index', () => {
  return {
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
    MemoryMonitorManager: class {
      start = vi.fn().mockReturnValue('monitor-123');
      stop = vi.fn().mockReturnValue(true);
    },
    checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    checkDebugPort: vi.fn(),
  };
});

import * as memoryImpl from '@modules/process/memory/index';

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('MemoryManager', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('detects win32 platform correctly', () => {
    setPlatform('win32');
    const manager = new MemoryManager();
    expect((manager as any).platform).toBe('win32');
  });

  it('detects linux platform correctly', () => {
    setPlatform('linux');
    const manager = new MemoryManager();
    expect((manager as any).platform).toBe('linux');
  });

  it('detects darwin platform correctly', () => {
    setPlatform('darwin');
    const manager = new MemoryManager();
    expect((manager as any).platform).toBe('darwin');
  });

  it('falls back to unknown platform', () => {
    setPlatform('freebsd');
    const manager = new MemoryManager();
    expect((manager as any).platform).toBe('unknown');
  });

  describe('delegates correctly', () => {
    let manager: MemoryManager;

    beforeEach(() => {
      setPlatform('win32');
      manager = new MemoryManager();
    });

    it('readMemory', async () => {
      await manager.readMemory(1234, '0x1000', 10);
      expect(memoryImpl.readMemory).toHaveBeenCalled();
      // Test the protection callback
      const callback = vi.mocked(memoryImpl.readMemory).mock.calls[0]?.[4] as any;
      if (callback) {
        await callback(1234, '0x1000');
        expect(memoryImpl.checkMemoryProtection).toHaveBeenCalledWith('win32', 1234, '0x1000');
      }
    });

    it('writeMemory', async () => {
      await manager.writeMemory(1234, '0x1000', 'data', 'hex');
      expect(memoryImpl.writeMemory).toHaveBeenCalled();
      const callback = vi.mocked(memoryImpl.writeMemory).mock.calls[0]?.[5] as any;
      if (callback) {
        await callback(1234, '0x1000');
        expect(memoryImpl.checkMemoryProtection).toHaveBeenCalled();
      }
    });

    it('batchMemoryWrite', async () => {
      await manager.batchMemoryWrite(1234, [{ address: '0x1000', data: 'ff' }]);
      expect(memoryImpl.batchMemoryWrite).toHaveBeenCalled();
      const callback = vi.mocked(memoryImpl.batchMemoryWrite).mock.calls[0]?.[2] as any;
      if (callback) {
        await callback(1234, '0x1000', 'ff', 'hex');
        expect(memoryImpl.writeMemory).toHaveBeenCalled(); // Since writeMemory calls checkMemoryProtection etc.
      }
    });

    it('scanMemory', async () => {
      await manager.scanMemory(1234, 'patterns', 'string', true);
      expect(memoryImpl.scanMemory).toHaveBeenCalledWith('win32', 1234, 'patterns', 'string', true);
    });

    it('scanMemoryFiltered', async () => {
      await manager.scanMemoryFiltered(1234, 'patterns', ['0x1000'], 'hex');
      expect(memoryImpl.scanMemoryFiltered).toHaveBeenCalled();

      const readCb = vi.mocked(memoryImpl.scanMemoryFiltered).mock.calls[0]?.[4] as any;
      if (readCb) {
        await readCb(1234, '0x1000', 4);
        expect(memoryImpl.readMemory).toHaveBeenCalled();
      }

      const scanCb = vi.mocked(memoryImpl.scanMemoryFiltered).mock.calls[0]?.[5] as any;
      if (scanCb) {
        await scanCb(1234, 'patterns', 'hex');
        expect(memoryImpl.scanMemory).toHaveBeenCalled();
      }
    });

    it('dumpMemoryRegion', async () => {
      await manager.dumpMemoryRegion(1234, '0x1000', 256, '/tmp/dump');
      expect(memoryImpl.dumpMemoryRegion).toHaveBeenCalledWith(
        'win32',
        1234,
        '0x1000',
        256,
        '/tmp/dump',
      );
    });

    it('enumerateRegions', async () => {
      await manager.enumerateRegions(1234);
      expect(memoryImpl.enumerateRegions).toHaveBeenCalledWith('win32', 1234);
    });

    it('checkMemoryProtection', async () => {
      await manager.checkMemoryProtection(1234, '0x1000');
      expect(memoryImpl.checkMemoryProtection).toHaveBeenCalledWith('win32', 1234, '0x1000');
    });

    it('enumerateModules', async () => {
      await manager.enumerateModules(1234);
      expect(memoryImpl.enumerateModules).toHaveBeenCalledWith('win32', 1234);
    });

    it('injectDll', async () => {
      await manager.injectDll(1234, '/path/to/dll');
      expect(memoryImpl.injectDll).toHaveBeenCalledWith('win32', 1234, '/path/to/dll');
    });

    it('injectShellcode', async () => {
      await manager.injectShellcode(1234, '9090', 'hex');
      expect(memoryImpl.injectShellcode).toHaveBeenCalledWith('win32', 1234, '9090', 'hex');
    });

    it('checkDebugPort', async () => {
      await manager.checkDebugPort(1234);
      expect(memoryImpl.checkDebugPort).toHaveBeenCalledWith('win32', 1234);
    });

    it('startMemoryMonitor', () => {
      const monitorId = manager.startMemoryMonitor(1234, '0x1000', 4, 1000, () => {});
      expect(monitorId).toBe('monitor-123');
      const startFn = vi.mocked((manager as any).monitorManager.start);
      expect(startFn).toHaveBeenCalled();

      // Test the read callback passed to start
      const readCb = startFn.mock.calls[0]?.[4] as any;
      if (readCb) {
        readCb(1234, '0x1000', 4);
        expect(memoryImpl.readMemory).toHaveBeenCalled();
      }
    });

    it('stopMemoryMonitor', () => {
      const res = manager.stopMemoryMonitor('monitor-123');
      expect(res).toBe(true);
      expect((manager as any).monitorManager.stop).toHaveBeenCalledWith('monitor-123');
    });

    it('checkAvailability', async () => {
      await manager.checkAvailability();
      expect(memoryImpl.checkAvailability).toHaveBeenCalledWith('win32');
    });
  });
});
