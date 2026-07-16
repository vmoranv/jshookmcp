import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

const mocks = vi.hoisted(() => ({
  processManager: {
    getPlatform: vi.fn(() => 'linux'),
    getProcessByPid: vi.fn(),
  },
  memoryManager: {
    checkAvailability: vi.fn(),
    enumerateModules: vi.fn(),
  },
  enumerateThreadsByPlatform: vi.fn(),
}));

vi.mock('@src/modules/process/index', () => ({
  UnifiedProcessManager: function UnifiedProcessManagerMock() {
    return mocks.processManager;
  },
  MemoryManager: function MemoryManagerMock() {
    return mocks.memoryManager;
  },
}));

vi.mock('@modules/process/threads/thread-status-parser', () => ({
  readThreadStatusSafe: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@native/platform/ThreadEnumerator', () => ({
  enumerateThreadsByPlatform: mocks.enumerateThreadsByPlatform,
}));

import { ProcessToolHandlers } from '@server/domains/process/handlers';

describe('process_enum_threads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processManager.getPlatform.mockReturnValue('linux');
    mocks.processManager.getProcessByPid.mockResolvedValue({
      pid: 1234,
      name: 'node',
      executablePath: '/usr/bin/node',
    });
    mocks.memoryManager.checkAvailability.mockResolvedValue({
      available: true,
      reason: null,
    });
    mocks.memoryManager.enumerateModules.mockResolvedValue({
      success: true,
      modules: [{ name: 'node', baseAddress: '0x1000' }],
    });
    mocks.enumerateThreadsByPlatform.mockResolvedValue([1234, 1235]);
  });

  it('keeps the default thread ID response compact', async () => {
    const handlers = new ProcessToolHandlers();

    const body = parseJson<any>(await handlers.handleProcessEnumThreads({ pid: 1234 }));

    expect(body).toMatchObject({
      success: true,
      pid: 1234,
      platform: 'linux',
      threadCount: 2,
      threadIds: [1234, 1235],
    });
    expect(body.threads).toBeUndefined();
    expect(body.diagnostics).toBeUndefined();
  });

  it('includes per-thread context and diagnostics when requested', async () => {
    const handlers = new ProcessToolHandlers();

    const body = parseJson<any>(
      await handlers.handleProcessEnumThreads({ pid: 1234, includeDetails: true }),
    );

    expect(mocks.enumerateThreadsByPlatform).toHaveBeenCalledWith('linux', 1234);
    expect(body.threads).toEqual([
      { threadId: 1234, ordinal: 0, isProcessMainThread: true },
      { threadId: 1235, ordinal: 1, isProcessMainThread: false },
    ]);
    expect(body.diagnostics.process).toMatchObject({
      exists: true,
      pid: 1234,
      name: 'node',
    });
    expect(body.diagnostics.permission).toMatchObject({
      available: true,
      platform: 'linux',
    });
  });

  it('rejects non-boolean includeDetails values', async () => {
    const handlers = new ProcessToolHandlers();

    const body = parseJson<any>(
      await handlers.handleProcessEnumThreads({ pid: 1234, includeDetails: 'yes' }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('includeDetails must be a boolean when provided');
    expect(mocks.enumerateThreadsByPlatform).not.toHaveBeenCalled();
  });
});
