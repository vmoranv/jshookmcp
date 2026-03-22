import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  scanMemoryMock,
  dumpMemoryRegionMock,
  enumerateRegionsMock,
  checkMemoryProtectionMock,
  scanMemoryFilteredMock,
  batchMemoryWriteMock,
  startMemoryMonitorMock,
  stopMemoryMonitorMock,
  injectDllMock,
  injectShellcodeMock,
  checkDebugPortMock,
  enumerateModulesMock,
  MemoryManagerMock,
} = vi.hoisted(() => {
  const scanMemoryMock = vi.fn();
  const dumpMemoryRegionMock = vi.fn();
  const enumerateRegionsMock = vi.fn();
  const checkMemoryProtectionMock = vi.fn();
  const scanMemoryFilteredMock = vi.fn();
  const batchMemoryWriteMock = vi.fn();
  const startMemoryMonitorMock = vi.fn(() => 'monitor-1');
  const stopMemoryMonitorMock = vi.fn(() => true);
  const injectDllMock = vi.fn();
  const injectShellcodeMock = vi.fn();
  const checkDebugPortMock = vi.fn();
  const enumerateModulesMock = vi.fn();

  class MemoryManagerMock {
    scanMemory = scanMemoryMock;
    dumpMemoryRegion = dumpMemoryRegionMock;
    enumerateRegions = enumerateRegionsMock;
    checkMemoryProtection = checkMemoryProtectionMock;
    scanMemoryFiltered = scanMemoryFilteredMock;
    batchMemoryWrite = batchMemoryWriteMock;
    startMemoryMonitor = startMemoryMonitorMock;
    stopMemoryMonitor = stopMemoryMonitorMock;
    injectDll = injectDllMock;
    injectShellcode = injectShellcodeMock;
    checkDebugPort = checkDebugPortMock;
    enumerateModules = enumerateModulesMock;
  }

  return {
    scanMemoryMock,
    dumpMemoryRegionMock,
    enumerateRegionsMock,
    checkMemoryProtectionMock,
    scanMemoryFilteredMock,
    batchMemoryWriteMock,
    startMemoryMonitorMock,
    stopMemoryMonitorMock,
    injectDllMock,
    injectShellcodeMock,
    checkDebugPortMock,
    enumerateModulesMock,
    MemoryManagerMock,
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/process/MemoryManager', () => ({
  MemoryManager: MemoryManagerMock,
}));

import * as memoryUtils from '@modules/process/memoryUtils';

describe('memoryUtils wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scanMemory wrapper delegates with default pattern type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    scanMemoryMock.mockResolvedValue({ success: true, addresses: ['0x1'] });
    const result = await memoryUtils.scanMemory(1, 'AA BB');

    expect(result.success).toBe(true);
    expect(scanMemoryMock).toHaveBeenCalledWith(1, 'AA BB', 'hex');
  });

  it('dumpMemory/listMemoryRegions/checkProtection wrappers delegate correctly', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    dumpMemoryRegionMock.mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    enumerateRegionsMock.mockResolvedValue({ success: true, regions: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    checkMemoryProtectionMock.mockResolvedValue({ success: true, isReadable: true });

    await memoryUtils.dumpMemory(2, '0x1000', 16, '/tmp/a.bin');
    await memoryUtils.listMemoryRegions(2);
    await memoryUtils.checkProtection(2, '0x1000');

    expect(dumpMemoryRegionMock).toHaveBeenCalledWith(2, '0x1000', 16, '/tmp/a.bin');
    expect(enumerateRegionsMock).toHaveBeenCalledWith(2);
    expect(checkMemoryProtectionMock).toHaveBeenCalledWith(2, '0x1000');
  });

  it('scanFiltered and batchWrite wrappers delegate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    scanMemoryFilteredMock.mockResolvedValue({ success: true, addresses: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    batchMemoryWriteMock.mockResolvedValue({ success: true, results: [] });

    await memoryUtils.scanFiltered(3, 'AA', ['0x10'], 'hex');
    await memoryUtils.batchWrite(3, [{ address: '0x10', data: '90' }]);

    expect(scanMemoryFilteredMock).toHaveBeenCalledWith(3, 'AA', ['0x10'], 'hex');
    expect(batchMemoryWriteMock).toHaveBeenCalledWith(3, [{ address: '0x10', data: '90' }]);
  });

  it('startMonitor/stopMonitor wrappers delegate and return values', () => {
    const onChange = vi.fn();
    const id = memoryUtils.startMonitor(4, '0x20', 8, 500, onChange);
    const stopped = memoryUtils.stopMonitor(id);

    expect(id).toBe('monitor-1');
    expect(stopped).toBe(true);
    expect(startMemoryMonitorMock).toHaveBeenCalledWith(4, '0x20', 8, 500, onChange);
    expect(stopMemoryMonitorMock).toHaveBeenCalledWith('monitor-1');
  });

  it('injection/debug/module wrappers delegate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    injectDllMock.mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    injectShellcodeMock.mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    checkDebugPortMock.mockResolvedValue({ success: true, isDebugged: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    enumerateModulesMock.mockResolvedValue({ success: true, modules: [] });

    await memoryUtils.injectDll(5, 'a.dll');
    await memoryUtils.injectShellcode(5, '90', 'hex');
    await memoryUtils.checkDebugPort(5);
    await memoryUtils.enumerateModules(5);

    expect(injectDllMock).toHaveBeenCalledWith(5, 'a.dll');
    expect(injectShellcodeMock).toHaveBeenCalledWith(5, '90', 'hex');
    expect(checkDebugPortMock).toHaveBeenCalledWith(5);
    expect(enumerateModulesMock).toHaveBeenCalledWith(5);
  });
});
