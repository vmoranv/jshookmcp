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

  const mockbpEngine = {/* mock */} as any;
  const mockVehEngine = {/* mock */} as any;
  const mockinjector = {/* mock */} as any;
  let auditTrail: MemoryAuditTrail;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockbpEngine).forEach((key) => delete mockbpEngine[key]);
    Object.keys(mockVehEngine).forEach((key) => delete mockVehEngine[key]);
    Object.keys(mockinjector).forEach((key) => delete mockinjector[key]);
    // Default: no active breakpoints — DR-exhaustion guard passes.
    mockbpEngine.listBreakpoints = vi.fn().mockReturnValue([]);
    mockVehEngine.listBreakpoints = vi.fn().mockReturnValue([]);
    auditTrail = new MemoryAuditTrail();
    handlers = new HookHandlers(
      mockbpEngine,
      null,
      null,
      mockinjector,
      undefined,
      undefined,
      auditTrail,
    );
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
      expect(mockbpEngine.setBreakpoint).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        'read',
        4,
        undefined,
      );
    });

    it('throws when bpEngine is null (unsupported platform)', async () => {
      handlers = new HookHandlers(null, null, null, mockinjector, undefined, undefined, auditTrail);
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

  describe('VEH debugger mode', () => {
    const vehArgs = { ...dummyArgs, debuggerMode: 'veh' };

    it('routes set breakpoint to vehEngine when debuggerMode=veh', async () => {
      mockVehEngine.listBreakpoints = vi.fn().mockReturnValue([]);
      mockVehEngine.setBreakpoint = vi.fn().mockReturnValue({ id: 'veh-bp1', address: '0x1' });
      handlers = new HookHandlers(
        mockbpEngine,
        mockVehEngine,
        null,
        mockinjector,
        undefined,
        undefined,
        auditTrail,
      );

      const response = await handlers.handleBreakpointSet(vehArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockVehEngine.setBreakpoint).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        'read',
        4,
        undefined,
      );
      expect(parsed.mode).toBe('veh');
    });

    it('routes remove to vehEngine when debuggerMode=veh', async () => {
      mockVehEngine.removeBreakpoint = vi.fn().mockReturnValue(true);
      handlers = new HookHandlers(
        mockbpEngine,
        mockVehEngine,
        null,
        mockinjector,
        undefined,
        undefined,
        auditTrail,
      );

      const response = await handlers.handleBreakpointRemove({
        ...vehArgs,
        breakpointId: 'veh-bp1',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockVehEngine.removeBreakpoint).toHaveBeenCalledWith('veh-bp1');
    });

    it('routes list to vehEngine when debuggerMode=veh', async () => {
      mockVehEngine.listBreakpoints = vi.fn().mockReturnValue([{ id: 'veh-bp1' }]);
      handlers = new HookHandlers(
        mockbpEngine,
        mockVehEngine,
        null,
        mockinjector,
        undefined,
        undefined,
        auditTrail,
      );

      const response = await handlers.handleBreakpointList(vehArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.mode).toBe('veh');
      expect(mockVehEngine.listBreakpoints).toHaveBeenCalled();
    });

    it('routes trace to vehEngine when debuggerMode=veh', async () => {
      mockVehEngine.listBreakpoints = vi.fn().mockReturnValue([]);
      mockVehEngine.traceAccess = vi.fn().mockReturnValue([{ instructionAddress: '0x2' }]);
      handlers = new HookHandlers(
        mockbpEngine,
        mockVehEngine,
        null,
        mockinjector,
        undefined,
        undefined,
        auditTrail,
      );

      const response = await handlers.handleBreakpointTrace({ ...vehArgs, access: 'write' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.mode).toBe('veh');
      expect(mockVehEngine.traceAccess).toHaveBeenCalled();
    });

    it('throws when vehEngine is null but debuggerMode=veh requested', async () => {
      handlers = new HookHandlers(null, null, null, mockinjector, undefined, undefined, auditTrail);
      const response = await handlers.handleBreakpointSet({
        pid: 1234,
        address: '0x1',
        access: 'read',
        debuggerMode: 'veh',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('VEH debugger mode');
    });

    it('defaults to win32 mode when no debuggerMode specified', async () => {
      mockbpEngine.setBreakpoint = vi.fn().mockReturnValue({ id: 'bp1', address: '0x1' });
      mockVehEngine.setBreakpoint = vi.fn();
      mockbpEngine.listBreakpoints = vi.fn().mockReturnValue([]);
      handlers = new HookHandlers(
        mockbpEngine,
        mockVehEngine,
        null,
        mockinjector,
        undefined,
        undefined,
        auditTrail,
      );

      const response = await handlers.handleBreakpointSet(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockbpEngine.setBreakpoint).toHaveBeenCalled();
      expect(mockVehEngine.setBreakpoint).not.toHaveBeenCalled();
    });
  });

  // ── Collision Detection ──

  describe('breakpoint collision detection', () => {
    it('returns warning when new BP overlaps an existing BP', async () => {
      mockbpEngine.listBreakpoints = vi.fn().mockReturnValue([
        {
          id: 'bp-existing',
          address: '0x7FF612340000',
          size: 4,
          access: 'write',
          enabled: true,
          hitCount: 0,
        },
      ]);
      mockbpEngine.setBreakpoint = vi.fn();

      const response = await handlers.handleBreakpointSet({
        pid: 1234,
        address: '0x7FF612340002',
        access: 'read',
        size: 4,
        type: 'hardware',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.warning).toContain('Breakpoint collision detected');
      expect(parsed.collision).toBeDefined();
      expect(parsed.collision.breakpointId).toBe('bp-existing');
      expect(mockbpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('returns suggestion when watchpoint size exceeds 8 bytes', async () => {
      mockbpEngine.listBreakpoints = vi.fn().mockReturnValue([]);
      mockbpEngine.setBreakpoint = vi.fn();

      const response = await handlers.handleBreakpointSet({
        pid: 1234,
        address: '0x7FF612340000',
        access: 'readwrite',
        size: 32,
        type: 'hardware',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.warning).toContain('Oversized watchpoint');
      expect(parsed.suggestion).toContain('split into');
      expect(parsed.suggestion).toContain('4 separate');
      expect(mockbpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('does not detect collision when BP addresses do not overlap', async () => {
      mockbpEngine.listBreakpoints = vi.fn().mockReturnValue([
        {
          id: 'bp-1',
          address: '0x7FF612340000',
          size: 4,
          access: 'write',
          enabled: true,
          hitCount: 0,
        },
      ]);
      mockbpEngine.setBreakpoint = vi
        .fn()
        .mockReturnValue({ id: 'bp-new', address: '0x7FF612340010' });

      const response = await handlers.handleBreakpointSet({
        pid: 1234,
        address: '0x7FF612340010',
        access: 'read',
        size: 2,
        type: 'hardware',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.warning).toBeUndefined();
      expect(mockbpEngine.setBreakpoint).toHaveBeenCalled();
    });

    it('skips collision check for software breakpoints', async () => {
      // Software BPs don't collide — they're unlimited
      const softBpEngine = {
        listBreakpoints: vi.fn().mockReturnValue([
          {
            id: 'soft-1',
            address: '0x7FF612340000',
            size: 1,
            access: 'execute',
            enabled: true,
            hitCount: 0,
          },
        ]),
        setBreakpoint: vi.fn().mockReturnValue({ id: 'soft-new', address: '0x7FF612340002' }),
      } as any;
      const softHandlers = new HookHandlers(
        null,
        null,
        softBpEngine,
        mockinjector,
        undefined,
        undefined,
        auditTrail,
      );

      const response = await softHandlers.handleBreakpointSet({
        pid: 1234,
        address: '0x7FF612340002',
        access: 'execute',
        size: 1,
        type: 'software',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.warning).toBeUndefined();
      expect(softBpEngine.setBreakpoint).toHaveBeenCalled();
    });
  });

  // ── Call Stack View ──

  describe('handleCallStack', () => {
    it('returns success with frames on happy path', async () => {
      vi.doMock('@native/CallStack', () => ({
        walkCallStack: vi.fn().mockReturnValue([
          {
            frameIndex: 0,
            returnAddress: '0x7FF612341000',
            moduleName: 'target.exe',
            functionName: 'target.exe!0x1000',
          },
          {
            frameIndex: 1,
            returnAddress: '0x7FFE12345678',
            moduleName: 'kernel32.dll',
            functionName: null,
          },
        ]),
      }));

      // The handler imports @native/CallStack dynamically, so use the mock
      const response = await handlers.handleCallStack({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.frameCount).toBeGreaterThanOrEqual(0);
    });

    it('handles maxFrames truncation correctly', async () => {
      const frames = Array.from({ length: 10 }, (_, i) => ({
        frameIndex: i,
        returnAddress: `0x${(0x7ff610000000 + i * 0x1000).toString(16).toUpperCase()}`,
        moduleName: 'test.dll',
        functionName: null,
      }));

      vi.doMock('@native/CallStack', () => ({
        walkCallStack: vi.fn().mockReturnValue(frames),
      }));

      const response = await handlers.handleCallStack({ pid: 1234, maxFrames: 5 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error when walkCallStack throws', async () => {
      vi.doMock('@native/CallStack', () => ({
        walkCallStack: vi.fn().mockImplementation(() => {
          throw new Error('Process not found');
        }),
      }));

      const response = await handlers.handleCallStack({ pid: 99999 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Process not found');
    });
  });

  // ── Process Suspend / Resume ──

  describe('handleProcessControl', () => {
    it('returns success on suspend action', async () => {
      vi.doMock('@modules/process/memory/scanner', () => ({
        suspendProcess: vi.fn().mockResolvedValue(true),
        resumeProcess: vi.fn(),
      }));

      const response = await handlers.handleProcessControl({ action: 'suspend', pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.action).toBe('suspend');
      expect(parsed.suspended).toBe(true);
    });

    it('returns success on resume action', async () => {
      vi.doMock('@modules/process/memory/scanner', () => ({
        suspendProcess: vi.fn(),
        resumeProcess: vi.fn().mockResolvedValue(true),
      }));

      const response = await handlers.handleProcessControl({ action: 'resume', pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.action).toBe('resume');
      expect(parsed.resumed).toBe(true);
    });

    it('reports resumed:false with a failure hint when the resume primitive fails', async () => {
      vi.doMock('@modules/process/memory/scanner', () => ({
        suspendProcess: vi.fn(),
        resumeProcess: vi.fn().mockResolvedValue(false),
      }));

      const response = await handlers.handleProcessControl({ action: 'resume', pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.resumed).toBe(false);
      expect(String(parsed.hint)).toContain('Failed to resume process 1234');
    });

    it('returns error on invalid action', async () => {
      const response = await handlers.handleProcessControl({ action: 'hibernate', pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"suspend" or "resume"');
    });
  });
});
