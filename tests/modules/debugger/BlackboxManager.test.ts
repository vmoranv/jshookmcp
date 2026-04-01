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

  it('falls back to an escaped literal when the input is not a valid regex', async () => {
    await manager.blackboxByPattern('foo[');

    expect(manager.getAllBlackboxedPatterns()).toEqual(['foo\\[']);
    expect(session.send).toHaveBeenCalledWith('Debugger.setBlackboxPatterns', {
      patterns: ['foo\\['],
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
      BlackboxManager.COMMON_LIBRARY_PATTERNS.length,
    );
  });

  it('clears all blackbox patterns', async () => {
    await manager.blackboxByPattern('*lodash*.js');
    await manager.clearAllBlackboxedPatterns();

    expect(manager.getAllBlackboxedPatterns()).toEqual([]);
    expect(session.send).toHaveBeenCalledWith('Debugger.setBlackboxPatterns', { patterns: [] });
  });

  it('throws when blackboxCommonLibraries CDP call fails', async () => {
    session.send.mockRejectedValueOnce(new Error('cdp error'));

    await expect(manager.blackboxCommonLibraries()).rejects.toThrow('cdp error');
    // patterns were added to the set before the CDP call failed
    expect(manager.getAllBlackboxedPatterns()).toHaveLength(
      BlackboxManager.COMMON_LIBRARY_PATTERNS.length,
    );
  });

  it('throws when clearAllBlackboxedPatterns CDP call fails', async () => {
    await manager.blackboxByPattern('*lodash*.js');
    session.send.mockRejectedValueOnce(new Error('cdp clear error'));

    await expect(manager.clearAllBlackboxedPatterns()).rejects.toThrow('cdp clear error');
  });

  it('throws when close fails due to clearAllBlackboxedPatterns throwing', async () => {
    await manager.blackboxByPattern('*lodash*.js');
    // First clearAllBlackboxedPatterns call fails
    session.send.mockRejectedValueOnce(new Error('cdp clear error'));

    await expect(manager.close()).rejects.toThrow('cdp clear error');
  });

  it('throws when blackboxByPattern CDP call fails', async () => {
    session.send.mockRejectedValueOnce(new Error('cdp failure'));

    await expect(manager.blackboxByPattern('*foo*.js')).rejects.toThrow('cdp failure');
    expect(manager.getAllBlackboxedPatterns()).toEqual([]);
  });

  it('successfully unblackboxes an existing pattern', async () => {
    await manager.blackboxByPattern('*lodash*.js');
    const result = await manager.unblackboxByPattern('*lodash*.js');

    expect(result).toBe(true);
    expect(manager.getAllBlackboxedPatterns()).toEqual([]);
  });

  it('close() succeeds and logs without throwing', async () => {
    await manager.blackboxByPattern('*lodash*.js');

    await expect(manager.close()).resolves.toBeUndefined();
    expect(manager.getAllBlackboxedPatterns()).toEqual([]);
  });

  it('normalizePattern uses truthy branch of pattern || fallback', async () => {
    // Pass a plain non-empty non-wildcard string — covers pattern || '' truthy side
    await manager.blackboxByPattern('mylib.js');

    const patterns = manager.getAllBlackboxedPatterns();
    expect(patterns).toHaveLength(1);
    // 'mylib.js' is a valid regex (dot is not a special operator without a quantifier)
    expect(patterns[0]).toBe('mylib.js');
  });
});
