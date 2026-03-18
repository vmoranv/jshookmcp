import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
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

describe('ConsoleMonitor dynamic script helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs the dynamic monitor and generates tracer/watcher expressions', async () => {
    const send = vi.fn(async () => ({ result: { value: [] } }));
    const ctx = {
      ensureSession: vi.fn(async () => {}),
      cdpSession: { send },
      MAX_INJECTED_DYNAMIC_SCRIPTS: 25,
    };

    await enableDynamicScriptMonitoringCore(ctx);
    await injectFunctionTracerCore(ctx, 'fetch');
    await injectPropertyWatcherCore(ctx, 'window.navigator', 'userAgent');

    expect(send).toHaveBeenNthCalledWith(
      1,
      'Runtime.evaluate',
      expect.objectContaining({
        expression: expect.stringContaining('const maxRecords = 25;'),
      })
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'Runtime.evaluate',
      expect.objectContaining({
        expression: expect.stringContaining('window.fetch = new Proxy'),
      })
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      'Runtime.evaluate',
      expect.objectContaining({
        expression: expect.stringContaining(
          'Property watcher installed for window.navigator.userAgent'
        ),
      })
    );
  });

  it('reads, clears and resets dynamic monitor state from return-by-value expressions', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          value: [{ type: 'dynamic', src: '/app.js' }],
        },
      })
      .mockResolvedValueOnce({
        result: {
          value: { dynamicScriptsCleared: 2 },
        },
      })
      .mockResolvedValueOnce({
        result: {
          value: { scriptMonitorReset: true },
        },
      });
    const ctx = {
      ensureSession: vi.fn(async () => {}),
      cdpSession: { send },
      MAX_INJECTED_DYNAMIC_SCRIPTS: 10,
    };

    await expect(getDynamicScriptsCore(ctx)).resolves.toEqual([
      { type: 'dynamic', src: '/app.js' },
    ]);
    await expect(clearDynamicScriptBufferCore(ctx)).resolves.toEqual({ dynamicScriptsCleared: 2 });
    await expect(resetDynamicScriptMonitoringCore(ctx)).resolves.toEqual({
      scriptMonitorReset: true,
    });
  });

  it('returns safe fallbacks or prerequisite errors when no session is available', async () => {
    const ctx = {
      ensureSession: vi.fn(async () => {}),
      cdpSession: null,
      MAX_INJECTED_DYNAMIC_SCRIPTS: 10,
    };

    await expect(clearDynamicScriptBufferCore(ctx)).resolves.toEqual({ dynamicScriptsCleared: 0 });
    await expect(resetDynamicScriptMonitoringCore(ctx)).resolves.toEqual({
      scriptMonitorReset: false,
    });
    await expect(getDynamicScriptsCore(ctx)).rejects.toBeInstanceOf(PrerequisiteError);
    await expect(injectFunctionTracerCore(ctx, 'fetch')).rejects.toBeInstanceOf(PrerequisiteError);
    await expect(injectPropertyWatcherCore(ctx, 'window', 'name')).rejects.toBeInstanceOf(
      PrerequisiteError
    );
  });
});
