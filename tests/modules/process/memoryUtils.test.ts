import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
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
  MemoryManager: mocks.MemoryManagerMock,
}));

import * as memoryUtils from '@modules/process/memoryUtils';

describe('memoryUtils wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scanMemory wrapper delegates with default pattern type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.scanMemoryMock.mockResolvedValue({ success: true, addresses: ['0x1'] });
    const result = await memoryUtils.scanMemory(1, 'AA BB');

    expect(result.success).toBe(true);
    expect(mocks.scanMemoryMock).toHaveBeenCalledWith(1, 'AA BB', 'hex');
  });

  it('dumpMemory/listMemoryRegions/checkProtection wrappers delegate correctly', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.dumpMemoryRegionMock.mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.enumerateRegionsMock.mockResolvedValue({ success: true, regions: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.checkMemoryProtectionMock.mockResolvedValue({ success: true, isReadable: true });

    await memoryUtils.dumpMemory(2, '0x1000', 16, '/tmp/a.bin');
    await memoryUtils.listMemoryRegions(2);
    await memoryUtils.checkProtection(2, '0x1000');

    expect(mocks.dumpMemoryRegionMock).toHaveBeenCalledWith(2, '0x1000', 16, '/tmp/a.bin');
    expect(mocks.enumerateRegionsMock).toHaveBeenCalledWith(2);
    expect(mocks.checkMemoryProtectionMock).toHaveBeenCalledWith(2, '0x1000');
  });

  it('scanFiltered and batchWrite wrappers delegate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.scanMemoryFilteredMock.mockResolvedValue({ success: true, addresses: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.batchMemoryWriteMock.mockResolvedValue({ success: true, results: [] });

    await memoryUtils.scanFiltered(3, 'AA', ['0x10'], 'hex');
    await memoryUtils.batchWrite(3, [{ address: '0x10', data: '90' }]);

    expect(mocks.scanMemoryFilteredMock).toHaveBeenCalledWith(3, 'AA', ['0x10'], 'hex');
    expect(mocks.batchMemoryWriteMock).toHaveBeenCalledWith(3, [{ address: '0x10', data: '90' }]);
  });

  it('startMonitor/stopMonitor wrappers delegate and return values', () => {
    const onChange = vi.fn();
    const id = memoryUtils.startMonitor(4, '0x20', 8, 500, onChange);
    const stopped = memoryUtils.stopMonitor(id);

    expect(id).toBe('monitor-1');
    expect(stopped).toBe(true);
    expect(mocks.startMemoryMonitorMock).toHaveBeenCalledWith(4, '0x20', 8, 500, onChange);
    expect(mocks.stopMemoryMonitorMock).toHaveBeenCalledWith('monitor-1');
  });

  it('injection/debug/module wrappers delegate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.injectDllMock.mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.injectShellcodeMock.mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.checkDebugPortMock.mockResolvedValue({ success: true, isDebugged: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mocks.enumerateModulesMock.mockResolvedValue({ success: true, modules: [] });

    await memoryUtils.injectDll(5, 'a.dll');
    await memoryUtils.injectShellcode(5, '90', 'hex');
    await memoryUtils.checkDebugPort(5);
    await memoryUtils.enumerateModules(5);

    expect(mocks.injectDllMock).toHaveBeenCalledWith(5, 'a.dll');
    expect(mocks.injectShellcodeMock).toHaveBeenCalledWith(5, '90', 'hex');
    expect(mocks.checkDebugPortMock).toHaveBeenCalledWith(5);
    expect(mocks.enumerateModulesMock).toHaveBeenCalledWith(5);
  });
});
