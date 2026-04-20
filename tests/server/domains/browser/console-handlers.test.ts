import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleHandlers } from '@server/domains/browser/handlers/console-handlers';

describe('ConsoleHandlers', () => {
  let consoleMonitor: any;
  let detailedDataManager: any;
  let handlers: ConsoleHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleMonitor = {
      enable: vi.fn(),
      getLogs: vi.fn(),
      execute: vi.fn(),
    };
    detailedDataManager = {
      smartHandle: vi.fn((value: any) => ({ wrapped: value })),
    };
    handlers = new ConsoleHandlers({ consoleMonitor, detailedDataManager });
  });

  it('enables console monitoring and returns a success payload', async () => {
    consoleMonitor.enable.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleConsoleMonitor({ action: 'enable' }),
    );

    expect(consoleMonitor.enable).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Console monitoring enabled',
    });
  });

  it('gets logs, forwards filter args, and wraps the result with DetailedDataManager', async () => {
    consoleMonitor.getLogs.mockReturnValue([
      { type: 'error', text: 'boom' },
      { type: 'warn', text: 'careful' },
    ]);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleConsoleGetLogs({ type: 'error', limit: 25, since: 1000 }),
    );

    expect(consoleMonitor.getLogs).toHaveBeenCalledWith({
      type: 'error',
      limit: 25,
      since: 1000,
    });
    expect(detailedDataManager.smartHandle).toHaveBeenCalledWith(
      {
        count: 2,
        logs: [
          { type: 'error', text: 'boom' },
          { type: 'warn', text: 'careful' },
        ],
      },
      51200,
    );
    expect(body.success).toBe(true);
    expect(body.wrapped).toEqual({
      count: 2,
      logs: [
        { type: 'error', text: 'boom' },
        { type: 'warn', text: 'careful' },
      ],
    });
  });

  it('passes undefined filters when log query args are omitted', async () => {
    consoleMonitor.getLogs.mockReturnValue([]);

    await handlers.handleConsoleGetLogs({});

    expect(consoleMonitor.getLogs).toHaveBeenCalledWith({
      type: undefined,
      limit: undefined,
      since: undefined,
    });
  });

  it('executes console expressions and returns the result payload', async () => {
    consoleMonitor.execute.mockResolvedValue({ value: 42 });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleConsoleExecute({ expression: '6 * 7' }),
    );

    expect(consoleMonitor.execute).toHaveBeenCalledWith('6 * 7');
    expect(body).toEqual({
      success: true,
      result: { value: 42 },
    });
  });

  it('returns failure response for console execution errors', async () => {
    consoleMonitor.execute.mockRejectedValue(new Error('execution failed'));

    const response = await handlers.handleConsoleExecute({ expression: 'throw new Error()' });
    const body = parseJson<BrowserStatusResponse>(response);
    expect(body.success).toBe(false);
    expect(body.message).toContain('execution failed');
  });
});
