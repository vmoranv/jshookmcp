/**
 * Tests for process_suspend / process_resume MCP handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  suspendProcess: vi.fn(),
  resumeProcess: vi.fn(),
}));

vi.mock('@modules/process/memory/scanner', () => ({
  suspendProcess: (...args: unknown[]) => state.suspendProcess(...args),
  resumeProcess: (...args: unknown[]) => state.resumeProcess(...args),
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ProcessSuspendHandlers } from '@server/domains/process/handlers/process-suspend';

describe('ProcessSuspendHandlers', () => {
  let handlers: ProcessSuspendHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ProcessSuspendHandlers();
  });

  describe('handleProcessSuspend', () => {
    it('returns success shape when suspendProcess resolves true', async () => {
      state.suspendProcess.mockResolvedValue(true);

      const result = await handlers.handleProcessSuspend({ pid: 1234 });

      expect(result).toEqual({
        success: true,
        pid: 1234,
        suspended: true,
        platform: expect.any(String),
        message: 'Suspended process 1234',
      });
      expect(state.suspendProcess).toHaveBeenCalledWith(expect.any(String), 1234);
    });

    it('returns success=false message when suspendProcess resolves false', async () => {
      state.suspendProcess.mockResolvedValue(false);

      const result = await handlers.handleProcessSuspend({ pid: 1234 });

      expect(result).toMatchObject({
        success: true,
        pid: 1234,
        suspended: false,
      });
      expect(String((result as { message: string }).message)).toContain('Failed to suspend');
    });

    it('rejects pid <= 0 with error shape', async () => {
      const result = await handlers.handleProcessSuspend({ pid: 0 });

      expect(result).toEqual({ success: false, error: 'pid must be a positive integer' });
      expect(state.suspendProcess).not.toHaveBeenCalled();
    });

    it('rejects missing pid with error shape', async () => {
      const result = await handlers.handleProcessSuspend({});

      expect(result).toEqual({ success: false, error: 'pid must be a positive integer' });
      expect(state.suspendProcess).not.toHaveBeenCalled();
    });

    it('returns error shape when suspendProcess throws', async () => {
      state.suspendProcess.mockRejectedValue(new Error('boom'));

      const result = await handlers.handleProcessSuspend({ pid: 1234 });

      expect(result).toMatchObject({ success: false, pid: 1234 });
      expect(String((result as { error: string }).error)).toContain('boom');
    });
  });

  describe('handleProcessResume', () => {
    it('returns success shape when resumeProcess resolves', async () => {
      state.resumeProcess.mockResolvedValue(undefined);

      const result = await handlers.handleProcessResume({ pid: 1234 });

      expect(result).toEqual({
        success: true,
        pid: 1234,
        resumed: true,
        platform: expect.any(String),
      });
      expect(state.resumeProcess).toHaveBeenCalledWith(expect.any(String), 1234);
    });

    it('rejects pid <= 0 with error shape', async () => {
      const result = await handlers.handleProcessResume({ pid: -1 });

      expect(result).toEqual({ success: false, error: 'pid must be a positive integer' });
      expect(state.resumeProcess).not.toHaveBeenCalled();
    });

    it('rejects missing pid with error shape', async () => {
      const result = await handlers.handleProcessResume({});

      expect(result).toEqual({ success: false, error: 'pid must be a positive integer' });
      expect(state.resumeProcess).not.toHaveBeenCalled();
    });

    it('returns error shape when resumeProcess throws', async () => {
      state.resumeProcess.mockRejectedValue(new Error('resume boom'));

      const result = await handlers.handleProcessResume({ pid: 1234 });

      expect(result).toMatchObject({ success: false, pid: 1234 });
      expect(String((result as { error: string }).error)).toContain('resume boom');
    });
  });

  describe('platform resolution', () => {
    it('uses platformValue from processMgmt when provided', async () => {
      state.suspendProcess.mockResolvedValue(true);
      const fakeProcessMgmt = {
        platformValue: 'linux',
      } as unknown as ConstructorParameters<typeof ProcessSuspendHandlers>[0];

      const localHandlers = new ProcessSuspendHandlers(fakeProcessMgmt);
      const result = await localHandlers.handleProcessSuspend({ pid: 777 });

      expect((result as { platform: string }).platform).toBe('linux');
      expect(state.suspendProcess).toHaveBeenCalledWith('linux', 777);
    });
  });
});
