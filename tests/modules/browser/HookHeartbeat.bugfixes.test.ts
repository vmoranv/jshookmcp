import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { HookHeartbeat } from '@modules/browser/HookHeartbeat';

interface TestPage {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  isClosed: () => boolean;
  mainFrame: () => { url: () => string; parentFrame: () => null };
}

function createPage(): TestPage {
  return {
    on: vi.fn(),
    off: vi.fn(),
    evaluate: vi.fn(async () => undefined),
    isClosed: () => false,
    mainFrame: () => ({ url: () => 'about:blank', parentFrame: () => null }),
  };
}

describe('HookHeartbeat timer cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the evaluate timeout timer when re-injection succeeds', async () => {
    const page = createPage();
    const heartbeat = new HookHeartbeat(page as never, { debounceMs: 0 });
    heartbeat.addScript({ id: 'hook', source: 'window.__hook = true;' }).start();

    await (heartbeat as unknown as { reinjectAll: (url: string) => Promise<void> }).reinjectAll(
      'about:blank',
    );

    // One dangling 10 s timer per script per navigation would keep the event
    // loop alive; the timer must be cleared once evaluate() resolves.
    expect(vi.getTimerCount()).toBe(0);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('clears the evaluate timeout timer when re-injection fails', async () => {
    const page = createPage();
    page.evaluate.mockRejectedValueOnce(new Error('context destroyed'));
    const heartbeat = new HookHeartbeat(page as never, { debounceMs: 0 });
    heartbeat.addScript({ id: 'hook', source: 'window.__hook = true;' }).start();

    await (heartbeat as unknown as { reinjectAll: (url: string) => Promise<void> }).reinjectAll(
      'about:blank',
    );

    expect(vi.getTimerCount()).toBe(0);
  });
});
