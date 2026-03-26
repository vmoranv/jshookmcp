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

import {
  clearExceptionsCore,
  clearLogsCore,
  getExceptionsCore,
  getLogsCore,
  getStatsCore,
} from '@modules/monitor/ConsoleMonitor.impl.core.logs';

describe('ConsoleMonitor logs core helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters logs by type, timestamp and limit and reports stats', () => {
    const ctx = {
      messages: [
        { type: 'log', text: 'a', timestamp: 1 },
        { type: 'warn', text: 'b', timestamp: 5 },
        { type: 'warn', text: 'c', timestamp: 10 },
      ],
      exceptions: [],
    };

    expect(getLogsCore(ctx, { type: 'warn', since: 2, limit: 1 })).toEqual([
      { type: 'warn', text: 'c', timestamp: 10 },
    ]);
    expect(getStatsCore(ctx)).toEqual({
      totalMessages: 3,
      byType: { log: 1, warn: 2 },
    });
    expect(loggerState.debug).toHaveBeenCalled();
  });

  it('filters and clears exceptions and logs collections', () => {
    const ctx = {
      messages: [{ type: 'error', text: 'boom', timestamp: 20 }],
      exceptions: [
        { message: 'x', timestamp: 1, url: 'https://a.test/x.js' },
        { message: 'y', timestamp: 10, url: 'https://a.test/y.js' },
      ],
    };

    expect(getExceptionsCore(ctx, { url: 'y.js', since: 5 })).toEqual([
      { message: 'y', timestamp: 10, url: 'https://a.test/y.js' },
    ]);

    clearLogsCore(ctx);
    clearExceptionsCore(ctx);

    expect(ctx.messages).toEqual([]);
    expect(ctx.exceptions).toEqual([]);
    expect(loggerState.info).toHaveBeenCalledTimes(2);
  });
});
