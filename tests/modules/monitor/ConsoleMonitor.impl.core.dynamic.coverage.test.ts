import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@utils/logger', () => ({
  logger: mockState.logger,
}));

import { PrerequisiteError } from '@errors/PrerequisiteError';
import {
  clearDynamicScriptBufferCore,
  enableDynamicScriptMonitoringCore,
  getDynamicScriptsCore,
  injectFunctionTracerCore,
  injectPropertyWatcherCore,
  resetDynamicScriptMonitoringCore,
} from '@modules/monitor/ConsoleMonitor.impl.core.dynamic';

interface RuntimeEvaluateResult<T = unknown> {
  result?: {
    value?: T;
  };
}

interface CdpSessionLike {
  send: ReturnType<typeof vi.fn>;
}

interface DynamicCoreContext {
  ensureSession: ReturnType<typeof vi.fn>;
  cdpSession: CdpSessionLike | null;
  MAX_INJECTED_DYNAMIC_SCRIPTS: number;
}

function createMockContext(overrides?: Partial<DynamicCoreContext>): DynamicCoreContext {
  return {
    ensureSession: vi.fn(async () => {}),
    cdpSession: {
      send: vi.fn(async () => ({})),
    },
    MAX_INJECTED_DYNAMIC_SCRIPTS: 1000,
    ...overrides,
  };
}

describe('ConsoleMonitor.impl.core.dynamic.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('enableDynamicScriptMonitoringCore', () => {
    it('throws PrerequisiteError when cdpSession is null after ensureSession', async () => {
      const ctx = createMockContext({
        cdpSession: null,
      });

      await expect(enableDynamicScriptMonitoringCore(ctx)).rejects.toThrow(PrerequisiteError);
      await expect(enableDynamicScriptMonitoringCore(ctx)).rejects.toThrow(
        'CDP session not available after reconnect attempt',
      );
    });

    it('enables dynamic script monitoring in non-persistent mode', async () => {
      const ctx = createMockContext();

      await enableDynamicScriptMonitoringCore(ctx);

      expect(ctx.ensureSession).toHaveBeenCalledTimes(1);
      expect(ctx.cdpSession!.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: expect.stringContaining('window.__dynamicScriptMonitorInstalled'),
      });
      expect(mockState.logger.info).toHaveBeenCalledWith('Dynamic script monitoring enabled');
    });

    it('enables dynamic script monitoring in persistent mode', async () => {
      const ctx = createMockContext();

      await enableDynamicScriptMonitoringCore(ctx, { persistent: true });

      expect(ctx.ensureSession).toHaveBeenCalledTimes(1);
      expect(ctx.cdpSession!.send).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument', {
        source: expect.stringContaining('window.__dynamicScriptMonitorInstalled'),
      });
      expect(mockState.logger.info).toHaveBeenCalledWith(
        'Dynamic script monitoring enabled (persistent)',
      );
    });

    it('injects monitor code with correct MAX_INJECTED_DYNAMIC_SCRIPTS value', async () => {
      const ctx = createMockContext({
        MAX_INJECTED_DYNAMIC_SCRIPTS: 500,
      });

      await enableDynamicScriptMonitoringCore(ctx);

      const call = ctx.cdpSession!.send.mock.calls.find(
        (c: unknown[]) => c[0] === 'Runtime.evaluate',
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        expression: expect.stringContaining('const maxRecords = 500'),
      });
    });
  });

  describe('clearDynamicScriptBufferCore', () => {
    it('returns 0 when cdpSession is null', async () => {
      const ctx = createMockContext({
        cdpSession: null,
      });

      const result = await clearDynamicScriptBufferCore(ctx);

      expect(result).toEqual({ dynamicScriptsCleared: 0 });
    });

    it('returns dynamicScriptsCleared count when store is valid array', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: { dynamicScriptsCleared: 42 },
        },
      } as RuntimeEvaluateResult);

      const result = await clearDynamicScriptBufferCore(ctx);

      expect(result).toEqual({ dynamicScriptsCleared: 42 });
    });

    it('returns 0 when result.result is undefined', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({} as RuntimeEvaluateResult);

      const result = await clearDynamicScriptBufferCore(ctx);

      expect(result).toEqual({ dynamicScriptsCleared: 0 });
    });

    it('returns 0 when result.result.value is undefined', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {},
      } as RuntimeEvaluateResult);

      const result = await clearDynamicScriptBufferCore(ctx);

      expect(result).toEqual({ dynamicScriptsCleared: 0 });
    });

    it('returns 0 when value is null', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: null,
        },
      } as RuntimeEvaluateResult);

      const result = await clearDynamicScriptBufferCore(ctx);

      expect(result).toEqual({ dynamicScriptsCleared: 0 });
    });

    it('returns 0 when value is not an object', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: 'not-an-object',
        },
      } as RuntimeEvaluateResult);

      const result = await clearDynamicScriptBufferCore(ctx);

      expect(result).toEqual({ dynamicScriptsCleared: 0 });
    });

    it('returns 0 when dynamicScriptsCleared is not a number', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: { dynamicScriptsCleared: 'not-a-number' },
        },
      } as RuntimeEvaluateResult);

      const result = await clearDynamicScriptBufferCore(ctx);

      expect(result).toEqual({ dynamicScriptsCleared: 0 });
    });

    it('returns 0 and logs error when cdpSession.send throws', async () => {
      const ctx = createMockContext();
      const error = new Error('CDP error');
      ctx.cdpSession!.send.mockRejectedValueOnce(error);

      const result = await clearDynamicScriptBufferCore(ctx);

      expect(result).toEqual({ dynamicScriptsCleared: 0 });
      expect(mockState.logger.error).toHaveBeenCalledWith(
        'Failed to clear dynamic script buffer:',
        error,
      );
    });
  });

  describe('resetDynamicScriptMonitoringCore', () => {
    it('returns false when cdpSession is null', async () => {
      const ctx = createMockContext({
        cdpSession: null,
      });

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: false });
    });

    it('returns scriptMonitorReset true when reset succeeds', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: { scriptMonitorReset: true },
        },
      } as RuntimeEvaluateResult);

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: true });
    });

    it('returns scriptMonitorReset false when value is false', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: { scriptMonitorReset: false },
        },
      } as RuntimeEvaluateResult);

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: false });
    });

    it('returns false when result.result is undefined', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({} as RuntimeEvaluateResult);

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: false });
    });

    it('returns false when result.result.value is undefined', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {},
      } as RuntimeEvaluateResult);

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: false });
    });

    it('returns false when value is null', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: null,
        },
      } as RuntimeEvaluateResult);

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: false });
    });

    it('returns false when value is not an object', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: 123,
        },
      } as RuntimeEvaluateResult);

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: false });
    });

    it('returns false when scriptMonitorReset is not a boolean', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: { scriptMonitorReset: 'not-a-boolean' },
        },
      } as RuntimeEvaluateResult);

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: false });
    });

    it('returns false and logs error when cdpSession.send throws', async () => {
      const ctx = createMockContext();
      const error = new Error('CDP error');
      ctx.cdpSession!.send.mockRejectedValueOnce(error);

      const result = await resetDynamicScriptMonitoringCore(ctx);

      expect(result).toEqual({ scriptMonitorReset: false });
      expect(mockState.logger.error).toHaveBeenCalledWith(
        'Failed to reset dynamic script monitoring:',
        error,
      );
    });
  });

  describe('getDynamicScriptsCore', () => {
    it('throws PrerequisiteError when cdpSession is null', async () => {
      const ctx = createMockContext({
        cdpSession: null,
      });

      await expect(getDynamicScriptsCore(ctx)).rejects.toThrow(PrerequisiteError);
      await expect(getDynamicScriptsCore(ctx)).rejects.toThrow('CDP session not initialized');
    });

    it('returns array of dynamic scripts when valid', async () => {
      const ctx = createMockContext();
      const scripts = [
        { type: 'dynamic', src: 'https://example.com/script.js', timestamp: 123 },
        { type: 'dynamic', src: '(inline)', content: 'console.log("test")', timestamp: 456 },
      ];
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: scripts,
        },
      } as RuntimeEvaluateResult);

      const result = await getDynamicScriptsCore(ctx);

      expect(result).toEqual(scripts);
    });

    it('returns empty array when result.result is undefined', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({} as RuntimeEvaluateResult);

      const result = await getDynamicScriptsCore(ctx);

      expect(result).toEqual([]);
    });

    it('returns empty array when result.result.value is undefined', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {},
      } as RuntimeEvaluateResult);

      const result = await getDynamicScriptsCore(ctx);

      expect(result).toEqual([]);
    });

    it('returns empty array when value is not an array', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: { not: 'an array' },
        },
      } as RuntimeEvaluateResult);

      const result = await getDynamicScriptsCore(ctx);

      expect(result).toEqual([]);
    });

    it('returns empty array when value is null', async () => {
      const ctx = createMockContext();
      ctx.cdpSession!.send.mockResolvedValueOnce({
        result: {
          value: null,
        },
      } as RuntimeEvaluateResult);

      const result = await getDynamicScriptsCore(ctx);

      expect(result).toEqual([]);
    });

    it('returns empty array and logs error when cdpSession.send throws', async () => {
      const ctx = createMockContext();
      const error = new Error('CDP error');
      ctx.cdpSession!.send.mockRejectedValueOnce(error);

      const result = await getDynamicScriptsCore(ctx);

      expect(result).toEqual([]);
      expect(mockState.logger.error).toHaveBeenCalledWith('Failed to get dynamic scripts:', error);
    });
  });

  describe('injectFunctionTracerCore', () => {
    it('throws PrerequisiteError when cdpSession is null', async () => {
      const ctx = createMockContext({
        cdpSession: null,
      });

      await expect(injectFunctionTracerCore(ctx, 'myFunction')).rejects.toThrow(PrerequisiteError);
      await expect(injectFunctionTracerCore(ctx, 'myFunction')).rejects.toThrow(
        'CDP session not initialized',
      );
    });

    it('injects function tracer in non-persistent mode', async () => {
      const ctx = createMockContext();

      await injectFunctionTracerCore(ctx, 'myFunction');

      expect(ctx.cdpSession!.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: expect.stringContaining('window.myFunction'),
      });
      expect(mockState.logger.info).toHaveBeenCalledWith(
        'Function tracer injected for: myFunction',
      );
    });

    it('injects function tracer in persistent mode', async () => {
      const ctx = createMockContext();

      await injectFunctionTracerCore(ctx, 'myFunction', { persistent: true });

      expect(ctx.cdpSession!.send).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument', {
        source: expect.stringContaining('window.myFunction'),
      });
      expect(mockState.logger.info).toHaveBeenCalledWith(
        'Function tracer injected for: myFunction (persistent)',
      );
    });

    it('includes functionName in the injected code', async () => {
      const ctx = createMockContext();

      await injectFunctionTracerCore(ctx, 'customFunction');

      const call = ctx.cdpSession!.send.mock.calls.find(
        (c: unknown[]) => c[0] === 'Runtime.evaluate',
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        expression: expect.stringContaining('window.customFunction'),
      });
    });
  });

  describe('injectPropertyWatcherCore', () => {
    it('throws PrerequisiteError when cdpSession is null', async () => {
      const ctx = createMockContext({
        cdpSession: null,
      });

      await expect(injectPropertyWatcherCore(ctx, 'window.location', 'href')).rejects.toThrow(
        PrerequisiteError,
      );
      await expect(injectPropertyWatcherCore(ctx, 'window.location', 'href')).rejects.toThrow(
        'CDP session not initialized',
      );
    });

    it('injects property watcher in non-persistent mode', async () => {
      const ctx = createMockContext();

      await injectPropertyWatcherCore(ctx, 'window.location', 'href');

      expect(ctx.cdpSession!.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: expect.stringContaining('window.location'),
      });
      expect(mockState.logger.info).toHaveBeenCalledWith(
        'Property watcher injected for: window.location.href',
      );
    });

    it('injects property watcher in persistent mode', async () => {
      const ctx = createMockContext();

      await injectPropertyWatcherCore(ctx, 'window.location', 'href', { persistent: true });

      expect(ctx.cdpSession!.send).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument', {
        source: expect.stringContaining('window.location'),
      });
      expect(mockState.logger.info).toHaveBeenCalledWith(
        'Property watcher injected for: window.location.href (persistent)',
      );
    });

    it('includes objectPath and propertyName in the injected code', async () => {
      const ctx = createMockContext();

      await injectPropertyWatcherCore(ctx, 'document.body', 'className');

      const call = ctx.cdpSession!.send.mock.calls.find(
        (c: unknown[]) => c[0] === 'Runtime.evaluate',
      );
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        expression: expect.stringContaining('document.body'),
      });
      expect(call![1]).toMatchObject({
        expression: expect.stringContaining('className'),
      });
    });
  });
});
