import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'rebrowser-puppeteer-core';
import { PAGE_OPERATION_TIMEOUT_MS } from '@src/constants';
import { PageDialogController } from '@modules/collector/PageDialogController';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

function createCollector(page: unknown) {
  return { getActivePage: vi.fn(async () => page) };
}

describe('PageDialogController listener cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes the dialog listener when the wait times out', async () => {
    const page = { on: vi.fn(), off: vi.fn() } as unknown as Page;
    const controller = new PageDialogController(createCollector(page) as never);

    const pending = controller.handleDialog({ dismissAll: false });
    // Let getActivePage() resolve so the listener/timer are actually installed.
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(PAGE_OPERATION_TIMEOUT_MS + 1);
    const result = await pending;
    expect(result.handled).toBe(false);
    const handler = (page.on as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(page.off).toHaveBeenCalledWith('dialog', handler);
  });

  it('removes the dialog listener after it fires', async () => {
    const page = { on: vi.fn(), off: vi.fn() } as unknown as Page;
    const controller = new PageDialogController(createCollector(page) as never);

    const pending = controller.handleDialog({ dismissAll: false, accept: true });
    await Promise.resolve();
    await Promise.resolve();
    const handler = (page.on as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as (dialog: {
      type: () => string;
      message: () => string;
      accept: () => Promise<void>;
      dismiss: () => Promise<void>;
    }) => Promise<void>;

    await handler({
      type: () => 'alert',
      message: () => 'hello',
      accept: vi.fn(async () => undefined),
      dismiss: vi.fn(async () => undefined),
    });
    const result = await pending;

    expect(result).toMatchObject({ handled: true, type: 'alert' });
    expect(page.off).toHaveBeenCalledWith('dialog', handler);
    expect(vi.getTimerCount()).toBe(0);
  });
});
