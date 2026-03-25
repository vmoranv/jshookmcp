import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  handleHumanMouse,
  handleHumanScroll,
  handleHumanTyping,
} from '@server/domains/browser/handlers/human-behavior';

/** Minimal mock for CodeCollector */
function createMockCollector(hasPage = true) {
  const mouse = { move: vi.fn(), click: vi.fn() };
  const keyboard = { type: vi.fn(), press: vi.fn() };
  const page = hasPage
    ? {
        mouse,
        keyboard,
        click: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        evaluate: vi.fn().mockResolvedValue(null),
        url: () => 'http://test.local',
      }
    : null;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    collector: { getActivePage: vi.fn().mockResolvedValue(page) } as any,
    page,
    mouse,
    keyboard,
  };
}

/**
 * Helper: advance all pending timers so that sleep() calls resolve instantly.
 * We run the handler concurrently with a timer-advancing loop.
 */
async function runWithFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const promise = fn();
  // Keep flushing pending timers until the promise resolves
  let resolved = false;
  let result: T;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  let error: any;
  promise.then(
    (r) => {
      resolved = true;
      result = r;
    },
    (e) => {
      resolved = true;
      error = e;
    },
  );
  for (;;) {
    if (resolved) {
      break;
    }
    await vi.advanceTimersByTimeAsync(1000);
  }
  vi.useRealTimers();
  if (error) throw error;
  return result!;
}

describe('handleHumanMouse', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when no active page', async () => {
    const { collector } = createMockCollector(false);
    await expect(handleHumanMouse({ toX: 100, toY: 100 }, collector)).rejects.toThrow(
      /No active page/,
    );
  });

  it('throws when neither selector nor coordinates provided', async () => {
    const { collector } = createMockCollector(true);
    await expect(handleHumanMouse({}, collector)).rejects.toThrow(/selector.*toX\/toY/i);
  });

  it('clamps steps to [1, 500]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 100, toY: 100, steps: 0 }, collector),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result).steps).toBe(1);

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 100, toY: 100, steps: 999 }, c2),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result2).steps).toBe(500);
  }, 30_000);

  it('clamps durationMs to [10, 30000]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 100, toY: 100, durationMs: 0, steps: 1 }, collector),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result).durationMs).toBe(10);

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 100, toY: 100, durationMs: 99999, steps: 1 }, c2),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result2).durationMs).toBe(30000);
  }, 30_000);

  it('moves mouse and reports success', async () => {
    const { collector, mouse } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ fromX: 0, fromY: 0, toX: 100, toY: 200, steps: 2 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.to).toEqual({ x: 100, y: 200 });
    expect(mouse.move).toHaveBeenCalled();
  });

  it('clicks when click=true', async () => {
    const { collector, mouse } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 50, toY: 50, click: true, steps: 1 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.clicked).toBe(true);
    expect(mouse.click).toHaveBeenCalledWith(50, 50);
  });

  it('resolves selector to coordinates', async () => {
    const { collector, page } = createMockCollector(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page!.evaluate.mockResolvedValueOnce({ x: 200, y: 300 });
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ selector: '#btn', steps: 1 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.to).toEqual({ x: 200, y: 300 });
  });
});

describe('handleHumanScroll', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when no active page', async () => {
    const { collector } = createMockCollector(false);
    await expect(handleHumanScroll({}, collector)).rejects.toThrow(/No active page/);
  });

  it('clamps distance to [1, 10000]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanScroll({ distance: -5, segments: 1 }, collector),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result).requestedDistance).toBe(1);

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanScroll({ distance: 99999, segments: 1 }, c2),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result2).requestedDistance).toBe(10000);
  });

  it('clamps segments to [1, 200]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() => handleHumanScroll({ segments: 0 }, collector));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result).segments).toBe(1);

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() => handleHumanScroll({ segments: 999 }, c2));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result2).segments).toBe(200);
  }, 30_000);

  it('scrolls and reports success', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanScroll({ distance: 300, direction: 'down', segments: 2 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.direction).toBe('down');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.actualScrolled).toBeGreaterThan(0);
  });
});

describe('handleHumanTyping', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when no active page', async () => {
    const { collector } = createMockCollector(false);
    await expect(handleHumanTyping({ selector: '#input', text: 'hi' }, collector)).rejects.toThrow(
      /No active page/,
    );
  });

  it('requires selector and text', async () => {
    const { collector } = createMockCollector(true);
    await expect(handleHumanTyping({}, collector)).rejects.toThrow(/selector.*text/i);
  });

  it('clamps wpm to [10, 300]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'a', wpm: 1 }, collector),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result).wpm).toBe(10);

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'a', wpm: 999 }, c2),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result2).wpm).toBe(300);
  });

  it('clamps errorRate to [0, 0.3]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'a', errorRate: -1 }, collector),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result).errorRate).toBe(0);

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'a', errorRate: 0.9 }, c2),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parseJson<BrowserStatusResponse>(result2).errorRate).toBeCloseTo(0.3);
  });

  it('types text and reports success', async () => {
    const { collector, keyboard } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'hi', errorRate: 0 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.length).toBe(2);
    expect(keyboard.type).toHaveBeenCalled();
  });
});
