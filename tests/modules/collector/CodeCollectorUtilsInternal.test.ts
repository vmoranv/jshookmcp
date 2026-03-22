import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  collectPageMetadataImpl,
  getPerformanceMetricsImpl,
  navigateWithRetryImpl,
  shouldCollectUrlImpl,
} from '@modules/collector/CodeCollectorUtilsInternal';

describe('CodeCollector utils internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches urls against wildcard filter rules', () => {
    expect(shouldCollectUrlImpl('https://example.com/app.js', ['*app.js'])).toBe(true);
    expect(shouldCollectUrlImpl('https://example.com/app.css', ['*app.js'])).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(shouldCollectUrlImpl('https://example.com/any', [])).toBe(true);
  });

  it('retries navigation until it succeeds', async () => {
    vi.useFakeTimers();
    const goto = vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockRejectedValueOnce(new Error('first fail'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValueOnce(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const navigation = navigateWithRetryImpl({ goto } as any, 'https://example.com', {}, 2);
    await vi.advanceTimersByTimeAsync(1000);
    await navigation;

    expect(goto).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('collects performance metrics and page metadata with empty-object fallbacks', async () => {
    const page = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      evaluate: vi.fn().mockResolvedValueOnce({ totalTime: 120 }).mockResolvedValueOnce({
        title: 'Example',
        url: 'https://example.com',
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    await expect(getPerformanceMetricsImpl(page as any)).resolves.toEqual({ totalTime: 120 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    await expect(collectPageMetadataImpl(page as any)).resolves.toEqual({
      title: 'Example',
      url: 'https://example.com',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate = vi.fn().mockRejectedValue(new Error('boom'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    await expect(getPerformanceMetricsImpl(page as any)).resolves.toEqual({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    await expect(collectPageMetadataImpl(page as any)).resolves.toEqual({});
  });
});
