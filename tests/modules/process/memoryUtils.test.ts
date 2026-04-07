import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as memoryUtils from '../../../src/modules/process/memoryUtils';

const mockManagerInstances: any[] = [];
const noopCb = () => {};

vi.mock('@modules/process/MemoryManager', () => {
  return {
    MemoryManager: class {
      scanMemory = vi.fn();
      dumpMemoryRegion = vi.fn();
      enumerateRegions = vi.fn();
      checkMemoryProtection = vi.fn();
      scanMemoryFiltered = vi.fn();
      batchMemoryWrite = vi.fn();
      startMemoryMonitor = vi.fn();
      stopMemoryMonitor = vi.fn();
      injectDll = vi.fn();
      injectShellcode = vi.fn();
      checkDebugPort = vi.fn();
      enumerateModules = vi.fn();
      constructor() {
        mockManagerInstances.push(this);
      }
    },
  };
});

describe('memoryUtils', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockManagerInstances.length = 0;
  });

  it('scanMemory', async () => {
    await memoryUtils.scanMemory(1234, 'pattern', 'string');
    expect(mockManagerInstances[0].scanMemory).toHaveBeenCalledWith(1234, 'pattern', 'string');
  });

  it('dumpMemory', async () => {
    await memoryUtils.dumpMemory(1234, '0x100', 200, '/tmp/a');
    expect(mockManagerInstances[0].dumpMemoryRegion).toHaveBeenCalledWith(
      1234,
      '0x100',
      200,
      '/tmp/a',
    );
  });

  it('listMemoryRegions', async () => {
    await memoryUtils.listMemoryRegions(1234);
    expect(mockManagerInstances[0].enumerateRegions).toHaveBeenCalledWith(1234);
  });

  it('checkProtection', async () => {
    await memoryUtils.checkProtection(1234, '0x100');
    expect(mockManagerInstances[0].checkMemoryProtection).toHaveBeenCalledWith(1234, '0x100');
  });

  it('scanFiltered', async () => {
    await memoryUtils.scanFiltered(1234, 'pattern', ['0x100'], 'hex');
    expect(mockManagerInstances[0].scanMemoryFiltered).toHaveBeenCalledWith(
      1234,
      'pattern',
      ['0x100'],
      'hex',
    );
  });

  it('batchWrite', async () => {
    await memoryUtils.batchWrite(1234, [{ address: '0x1', data: 'ff' }]);
    expect(mockManagerInstances[0].batchMemoryWrite).toHaveBeenCalledWith(1234, [
      { address: '0x1', data: 'ff' },
    ]);
  });

  it('startMonitor', () => {
    memoryUtils.startMonitor(1234, '0x1', 4, 1000, noopCb);
    expect(mockManagerInstances[0].startMemoryMonitor).toHaveBeenCalledWith(
      1234,
      '0x1',
      4,
      1000,
      noopCb,
    );
  });

  it('stopMonitor', () => {
    memoryUtils.stopMonitor('monitor-1');
    expect(mockManagerInstances[0].stopMemoryMonitor).toHaveBeenCalledWith('monitor-1');
  });

  it('injectDll', async () => {
    await memoryUtils.injectDll(1234, '/dll');
    expect(mockManagerInstances[0].injectDll).toHaveBeenCalledWith(1234, '/dll');
  });

  it('injectShellcode', async () => {
    await memoryUtils.injectShellcode(1234, '90', 'hex');
    expect(mockManagerInstances[0].injectShellcode).toHaveBeenCalledWith(1234, '90', 'hex');
  });

  it('checkDebugPort', async () => {
    await memoryUtils.checkDebugPort(1234);
    expect(mockManagerInstances[0].checkDebugPort).toHaveBeenCalledWith(1234);
  });

  it('enumerateModules', async () => {
    await memoryUtils.enumerateModules(1234);
    expect(mockManagerInstances[0].enumerateModules).toHaveBeenCalledWith(1234);
  });
});
