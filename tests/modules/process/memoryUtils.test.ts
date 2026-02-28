import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const scanMemory = vi.fn();
  const dumpMemoryRegion = vi.fn();
  const enumerateRegions = vi.fn();
  const checkMemoryProtection = vi.fn();
  const scanMemoryFiltered = vi.fn();
  const batchMemoryWrite = vi.fn();
  const startMemoryMonitor = vi.fn(() => 'monitor-1');
  const stopMemoryMonitor = vi.fn(() => true);
  const injectDll = vi.fn();
  const injectShellcode = vi.fn();
  const checkDebugPort = vi.fn();
  const enumerateModules = vi.fn();

  class MemoryManager {
    scanMemory = scanMemory;
    dumpMemoryRegion = dumpMemoryRegion;
    enumerateRegions = enumerateRegions;
    checkMemoryProtection = checkMemoryProtection;
    scanMemoryFiltered = scanMemoryFiltered;
    batchMemoryWrite = batchMemoryWrite;
    startMemoryMonitor = startMemoryMonitor;
    stopMemoryMonitor = stopMemoryMonitor;
    injectDll = injectDll;
    injectShellcode = injectShellcode;
    checkDebugPort = checkDebugPort;
    enumerateModules = enumerateModules;
  }

  return {
    MemoryManager,
    scanMemory,
    dumpMemoryRegion,
    enumerateRegions,
    checkMemoryProtection,
    scanMemoryFiltered,
    batchMemoryWrite,
    startMemoryMonitor,
    stopMemoryMonitor,
    injectDll,
    injectShellcode,
    checkDebugPort,
    enumerateModules,
  };
});

vi.mock('../../../src/modules/process/MemoryManager.js', () => ({
  MemoryManager: state.MemoryManager,
}));

import {
  scanMemory,
  dumpMemory,
  listMemoryRegions,
  checkProtection,
  scanFiltered,
  batchWrite,
  startMonitor,
  stopMonitor,
  injectDll,
  injectShellcode,
  checkDebugPort,
  enumerateModules,
} from '../../../src/modules/process/memoryUtils.js';

describe('memoryUtils wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scanMemory wrapper delegates with default pattern type', async () => {
    state.scanMemory.mockResolvedValue({ success: true, addresses: ['0x1'] });
    const result = await scanMemory(1, 'AA BB');

    expect(result.success).toBe(true);
    expect(state.scanMemory).toHaveBeenCalledWith(1, 'AA BB', 'hex');
  });

  it('dumpMemory/listMemoryRegions/checkProtection wrappers delegate correctly', async () => {
    state.dumpMemoryRegion.mockResolvedValue({ success: true });
    state.enumerateRegions.mockResolvedValue({ success: true, regions: [] });
    state.checkMemoryProtection.mockResolvedValue({ success: true, isReadable: true });

    await dumpMemory(2, '0x1000', 16, '/tmp/a.bin');
    await listMemoryRegions(2);
    await checkProtection(2, '0x1000');

    expect(state.dumpMemoryRegion).toHaveBeenCalledWith(2, '0x1000', 16, '/tmp/a.bin');
    expect(state.enumerateRegions).toHaveBeenCalledWith(2);
    expect(state.checkMemoryProtection).toHaveBeenCalledWith(2, '0x1000');
  });

  it('scanFiltered and batchWrite wrappers delegate', async () => {
    state.scanMemoryFiltered.mockResolvedValue({ success: true, addresses: [] });
    state.batchMemoryWrite.mockResolvedValue({ success: true, results: [] });

    await scanFiltered(3, 'AA', ['0x10'], 'hex');
    await batchWrite(3, [{ address: '0x10', data: '90' }]);

    expect(state.scanMemoryFiltered).toHaveBeenCalledWith(3, 'AA', ['0x10'], 'hex');
    expect(state.batchMemoryWrite).toHaveBeenCalledWith(3, [{ address: '0x10', data: '90' }]);
  });

  it('startMonitor/stopMonitor wrappers delegate and return values', () => {
    const onChange = vi.fn();
    const id = startMonitor(4, '0x20', 8, 500, onChange);
    const stopped = stopMonitor(id);

    expect(id).toBe('monitor-1');
    expect(stopped).toBe(true);
    expect(state.startMemoryMonitor).toHaveBeenCalledWith(4, '0x20', 8, 500, onChange);
    expect(state.stopMemoryMonitor).toHaveBeenCalledWith('monitor-1');
  });

  it('injection/debug/module wrappers delegate', async () => {
    state.injectDll.mockResolvedValue({ success: true });
    state.injectShellcode.mockResolvedValue({ success: true });
    state.checkDebugPort.mockResolvedValue({ success: true, isDebugged: false });
    state.enumerateModules.mockResolvedValue({ success: true, modules: [] });

    await injectDll(5, 'a.dll');
    await injectShellcode(5, '90', 'hex');
    await checkDebugPort(5);
    await enumerateModules(5);

    expect(state.injectDll).toHaveBeenCalledWith(5, 'a.dll');
    expect(state.injectShellcode).toHaveBeenCalledWith(5, '90', 'hex');
    expect(state.checkDebugPort).toHaveBeenCalledWith(5);
    expect(state.enumerateModules).toHaveBeenCalledWith(5);
  });
});
