import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { BlackboxManager } from '@modules/debugger/BlackboxManager';

interface MockCDPSession {
  send: Mock;
  on: Mock;
  off: Mock;
  detach: Mock;
}

function createSession(): MockCDPSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn(),
  };
}

describe('BlackboxManager', () => {
  let session: MockCDPSession;
  let manager: BlackboxManager;

  beforeEach(() => {
    session = createSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    manager = new BlackboxManager(session as any);
  });

  it('normalizes wildcard patterns and sends to CDP', async () => {
    await manager.blackboxByPattern('*vendor-lib*.js');

    const patterns = manager.getAllBlackboxedPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toContain('.*vendor-lib.*');
    expect(session.send).toHaveBeenCalledWith('Debugger.setBlackboxPatterns', {
      patterns,
    });
  });

  it('rejects empty patterns', async () => {
    await expect(manager.blackboxByPattern('   ')).rejects.toThrow('Pattern cannot be empty');
  });

  it('returns false when removing a non-existing pattern', async () => {
    await expect(manager.unblackboxByPattern('*missing*')).resolves.toBe(false);
  });

  it('rolls back deletion when unblackbox request fails', async () => {
    await manager.blackboxByPattern('*ui-framework*.js');
    session.send.mockRejectedValueOnce(new Error('cdp failure'));

    await expect(manager.unblackboxByPattern('*ui-framework*.js')).rejects.toThrow('cdp failure');
    expect(manager.getAllBlackboxedPatterns()[0]).toContain('ui-framework');
  });

  it('loads common library patterns in one call', async () => {
    await manager.blackboxCommonLibraries();
    expect(manager.getAllBlackboxedPatterns().length).toBe(
      BlackboxManager.COMMON_LIBRARY_PATTERNS.length
    );
  });

  it('clears all blackbox patterns', async () => {
    await manager.blackboxByPattern('*lodash*.js');
    await manager.clearAllBlackboxedPatterns();

    expect(manager.getAllBlackboxedPatterns()).toEqual([]);
    expect(session.send).toHaveBeenCalledWith('Debugger.setBlackboxPatterns', { patterns: [] });
  });
});
