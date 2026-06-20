import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookHandlers } from '../../../../../src/server/domains/memory/handlers/hooks';
import { MemoryAuditTrail } from '../../../../../src/modules/process/memory/AuditTrail';

describe('HookHandlers', () => {
  let handlers: HookHandlers;
  const dummyArgs = {
    pid: 1234,
    address: '0x7FF612340000',
    access: 'read',
    size: 4,
    breakpointId: 'bp-1',
    bytes: [0x90, 0x90],
    count: 4,
    patchId: 'patch-1',
    minSize: 16,
    maxHits: 50,
    timeoutMs: 10000,
  };

  const mockbpEngine = {
    /* mock */
  } as any;
  const mockinjector = {
    /* mock */
  } as any;
  let auditTrail: MemoryAuditTrail;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockbpEngine).forEach((key) => delete mockbpEngine[key]);
    Object.keys(mockinjector).forEach((key) => delete mockinjector[key]);
    auditTrail = new MemoryAuditTrail();
    handlers = new HookHandlers(mockbpEngine, mockinjector, undefined, undefined, auditTrail);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(HookHandlers);
  });

  describe('handleBreakpointSet', () => {
    it('returns success response on happy path', async () => {
      mockbpEngine.setBreakpoint = vi.fn().mockReturnValue({ id: 'bp1', address: '0x1' });

      const response = await handlers.handleBreakpointSet(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockbpEngine.setBreakpoint).toHaveBeenCalledWith(1234, '0x7FF612340000', 'read', 4);
    });

    it('throws when bpEngine is null (unsupported platform)', async () => {
      handlers = new HookHandlers(null, mockinjector, undefined, undefined, auditTrail);
      mockbpEngine.setBreakpoint = vi.fn();
      const response = await handlers.handleBreakpointSet(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('only supported on Windows');
      expect(mockbpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('returns error response on failure', async () => {
      mockbpEngine.setBreakpoint = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleBreakpointSet(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects invalid access', async () => {
      mockbpEngine.setBreakpoint = vi.fn();
      const response = await handlers.handleBreakpointSet({
        pid: 1234,
        address: '0x1',
        access: 'bogus',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid access');
      expect(mockbpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('rejects invalid address', async () => {
      mockbpEngine.setBreakpoint = vi.fn();
      const response = await handlers.handleBreakpointSet({
        pid: 1234,
        address: 'xyz',
        access: 'read',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('address must be a hex address');
      expect(mockbpEngine.setBreakpoint).not.toHaveBeenCalled();
    });
  });

  describe('handleBreakpointRemove', () => {
    it('returns success response on happy path', async () => {
      mockbpEngine.removeBreakpoint = vi.fn().mockReturnValue(true);

      const response = await handlers.handleBreakpointRemove(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockbpEngine.removeBreakpoint).toHaveBeenCalledWith('bp-1');
    });

    it('returns error response on failure', async () => {
      mockbpEngine.removeBreakpoint = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleBreakpointRemove(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing breakpointId', async () => {
      mockbpEngine.removeBreakpoint = vi.fn();
      const response = await handlers.handleBreakpointRemove({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('breakpointId');
      expect(mockbpEngine.removeBreakpoint).not.toHaveBeenCalled();
    });
  });

  describe('handleBreakpointList', () => {
    it('returns success response on happy path', async () => {
      mockbpEngine.listBreakpoints = vi.fn().mockReturnValue([{ id: 'bp1' }]);

      const response = await handlers.handleBreakpointList(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(1);
    });

    it('returns error response on failure', async () => {
      mockbpEngine.listBreakpoints = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleBreakpointList(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleBreakpointTrace', () => {
    it('returns success response on happy path', async () => {
      mockbpEngine.traceAccess = vi.fn().mockReturnValue([{ instructionAddress: '0x2' }]);

      const response = await handlers.handleBreakpointTrace(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hitCount).toBe(1);
      expect(mockbpEngine.traceAccess).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        'read',
        50,
        10000,
      );
    });

    it('returns error response on failure', async () => {
      mockbpEngine.traceAccess = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleBreakpointTrace(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing access', async () => {
      mockbpEngine.traceAccess = vi.fn();
      const response = await handlers.handleBreakpointTrace({ pid: 1234, address: '0x1' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"access"');
      expect(mockbpEngine.traceAccess).not.toHaveBeenCalled();
    });
  });

  describe('handlePatchBytes', () => {
    it('returns success response on happy path', async () => {
      mockinjector.patchBytes = vi.fn().mockReturnValue({ id: 'p1', address: '0x1' });

      const response = await handlers.handlePatchBytes(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockinjector.patchBytes).toHaveBeenCalledWith(1234, '0x7FF612340000', [0x90, 0x90]);
    });

    it('records audit on success and failure', async () => {
      mockinjector.patchBytes = vi.fn().mockReturnValue({ id: 'p1' });
      await handlers.handlePatchBytes(dummyArgs);
      mockinjector.patchBytes = vi.fn().mockImplementation(() => {
        throw new Error('boom');
      });
      await handlers.handlePatchBytes(dummyArgs);
      const entries = JSON.parse(auditTrail.exportJson());
      expect(entries).toHaveLength(2);
      expect(entries[0].operation).toBe('patch_bytes');
      expect(entries[0].result).toBe('success');
      expect(entries[0].size).toBe(2);
      expect(entries[1].result).toBe('failure');
      expect(entries[1].error).toContain('boom');
    });

    it('returns error response on failure', async () => {
      mockinjector.patchBytes = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePatchBytes(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects invalid bytes', async () => {
      mockinjector.patchBytes = vi.fn();
      const response = await handlers.handlePatchBytes({
        pid: 1234,
        address: '0x1',
        bytes: [10, 999],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('at index 1');
      expect(mockinjector.patchBytes).not.toHaveBeenCalled();
    });

    it('rejects empty bytes', async () => {
      mockinjector.patchBytes = vi.fn();
      const response = await handlers.handlePatchBytes({ pid: 1234, address: '0x1', bytes: [] });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('bytes must be a non-empty array');
      expect(mockinjector.patchBytes).not.toHaveBeenCalled();
    });
  });

  describe('handlePatchNop', () => {
    it('returns success response on happy path', async () => {
      mockinjector.nopBytes = vi.fn().mockReturnValue({ id: 'p2', address: '0x1' });

      const response = await handlers.handlePatchNop(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockinjector.nopBytes).toHaveBeenCalledWith(1234, '0x7FF612340000', 4);
    });

    it('returns error response on failure', async () => {
      mockinjector.nopBytes = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePatchNop(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects non-positive count', async () => {
      mockinjector.nopBytes = vi.fn();
      const response = await handlers.handlePatchNop({
        pid: 1234,
        address: '0x1',
        count: 0,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"count"');
      expect(mockinjector.nopBytes).not.toHaveBeenCalled();
    });

    it('records audit on success', async () => {
      mockinjector.nopBytes = vi.fn().mockReturnValue({ id: 'p2' });
      await handlers.handlePatchNop(dummyArgs);
      const entries = JSON.parse(auditTrail.exportJson());
      expect(entries).toHaveLength(1);
      expect(entries[0].operation).toBe('patch_nop');
      expect(entries[0].size).toBe(4);
    });
  });

  describe('handlePatchUndo', () => {
    it('returns success response on happy path', async () => {
      mockinjector.unpatch = vi.fn().mockReturnValue(true);

      const response = await handlers.handlePatchUndo(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockinjector.unpatch).toHaveBeenCalledWith('patch-1');
    });

    it('returns error response on failure', async () => {
      mockinjector.unpatch = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePatchUndo(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing patchId', async () => {
      mockinjector.unpatch = vi.fn();
      const response = await handlers.handlePatchUndo({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('patchId');
      expect(mockinjector.unpatch).not.toHaveBeenCalled();
    });
  });

  describe('handleCodeCaves', () => {
    it('returns success response on happy path', async () => {
      mockinjector.findCodeCaves = vi.fn().mockReturnValue([{ address: '0x10', size: 32 }]);

      const response = await handlers.handleCodeCaves(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(1);
      expect(mockinjector.findCodeCaves).toHaveBeenCalledWith(1234, 16);
    });

    it('returns error response on failure', async () => {
      mockinjector.findCodeCaves = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleCodeCaves(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects non-positive minSize', async () => {
      mockinjector.findCodeCaves = vi.fn();
      const response = await handlers.handleCodeCaves({ pid: 1234, minSize: -1 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"minSize" must be a positive number');
      expect(mockinjector.findCodeCaves).not.toHaveBeenCalled();
    });
  });
});
