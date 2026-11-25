import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageCDPTimeoutGuard, checkPageCDPHealth } from '@modules/collector/PageCDPTimeoutGuard';

function createCoveragePage() {
  return {
    coverage: {
      startJSCoverage: vi.fn(async () => undefined),
      stopJSCoverage: vi.fn(async () => []),
      startCSSCoverage: vi.fn(async () => undefined),
      stopCSSCoverage: vi.fn(async () => []),
    },
  };
}

describe('PageCDPTimeoutGuard timer cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the coverage timeout timer when the operation resolves', async () => {
    const guard = new PageCDPTimeoutGuard();
    const page = createCoveragePage();

    await guard.coverageStopJSWithTimeout(page);
    await guard.coverageStartJSWithTimeout(page);
    await guard.coverageStartCSSWithTimeout(page);
    await guard.coverageStopCSSWithTimeout(page);

    // Each wrapper used to leave a 30 s timer running after success.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the evaluateOnNewDocument timeout timer', async () => {
    const guard = new PageCDPTimeoutGuard();
    const page = {
      createCDPSession: vi.fn(async () => ({
        send: vi.fn(async () => ({ result: { value: 1 } })),
        detach: vi.fn(async () => undefined),
      })),
      evaluateOnNewDocument: vi.fn(async () => undefined),
    };

    await guard.evaluateOnNewDocumentWithTimeout(page as never, 'window.__x = 1;');

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('checkPageCDPHealth orphan session cleanup', () => {
  it('detaches a CDP session that resolves after the health check gave up', async () => {
    let resolveSession!: (session: {
      send: () => Promise<unknown>;
      detach: () => Promise<void>;
    }) => void;
    const sessionPromise = new Promise<{
      send: () => Promise<unknown>;
      detach: () => Promise<void>;
    }>((resolve) => {
      resolveSession = resolve;
    });
    const detach = vi.fn(async () => undefined);
    const page = {
      createCDPSession: vi.fn(() => sessionPromise),
    };

    await expect(checkPageCDPHealth(page as never, 5)).rejects.toThrow(/CDP session unresponsive/);

    resolveSession({ send: vi.fn(async () => ({})), detach });
    await vi.waitFor(() => {
      expect(detach).toHaveBeenCalledTimes(1);
    });
  });
});
