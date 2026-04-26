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
        evaluate: vi.fn().mockResolvedValue(null),
        url: () => 'http://test.local',
      }
    : null;
  return {
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

  it('returns failure when no active page', async () => {
    const { collector } = createMockCollector(false);
    const result = await handleHumanMouse({ toX: 100, toY: 100 }, collector);
    const body = parseJson<BrowserStatusResponse>(result);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/No active page/);
  });

  it('returns failure when neither selector nor coordinates provided', async () => {
    const { collector } = createMockCollector(true);
    const result = await handleHumanMouse({}, collector);
    const body = parseJson<BrowserStatusResponse>(result);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/selector.*toX\/toY/i);
  });

  it('clamps steps to [1, 500]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 100, toY: 100, steps: 0 }, collector),
    );
    expect(parseJson<BrowserStatusResponse>(result)).toMatchObject({ success: true, steps: 1 });

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 100, toY: 100, steps: 999 }, c2),
    );
    expect(parseJson<BrowserStatusResponse>(result2)).toMatchObject({ success: true, steps: 500 });
  }, 30_000);

  it('clamps durationMs to [10, 30000]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 100, toY: 100, durationMs: 0, steps: 1 }, collector),
    );
    expect(parseJson<BrowserStatusResponse>(result)).toMatchObject({
      success: true,
      durationMs: 10,
    });

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 100, toY: 100, durationMs: 99999, steps: 1 }, c2),
    );
    expect(parseJson<BrowserStatusResponse>(result2)).toMatchObject({
      success: true,
      durationMs: 30000,
    });
  }, 30_000);

  it('moves mouse and reports success', async () => {
    const { collector, mouse } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ fromX: 0, fromY: 0, toX: 100, toY: 200, steps: 2 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    expect(parsed.success).toBe(true);
    expect(parsed.to).toEqual({ x: 100, y: 200 });
    expect(mouse.move).toHaveBeenCalled();
  });

  it('clicks when click=true', async () => {
    const { collector, mouse } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ toX: 50, toY: 50, click: true, steps: 1 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    expect(parsed.clicked).toBe(true);
    expect(mouse.click).toHaveBeenCalledWith(50, 50);
  });

  it('resolves selector to coordinates', async () => {
    const { collector, page } = createMockCollector(true);
    page!.evaluate.mockResolvedValueOnce({ x: 200, y: 300 });
    const result = await runWithFakeTimers(() =>
      handleHumanMouse({ selector: '#btn', steps: 1 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    expect(parsed.success).toBe(true);
    expect(parsed.to).toEqual({ x: 200, y: 300 });
  });
});

describe('handleHumanScroll', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns failure when no active page', async () => {
    const { collector } = createMockCollector(false);
    const result = await handleHumanScroll({}, collector);
    const body = parseJson<BrowserStatusResponse>(result);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/No active page/);
  });

  it('clamps distance to [1, 10000]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanScroll({ distance: -5, segments: 1 }, collector),
    );
    expect(parseJson<BrowserStatusResponse>(result)).toMatchObject({
      success: true,
      requestedDistance: 1,
    });

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanScroll({ distance: 99999, segments: 1 }, c2),
    );
    expect(parseJson<BrowserStatusResponse>(result2)).toMatchObject({
      success: true,
      requestedDistance: 10000,
    });
  });

  it('clamps segments to [1, 200]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() => handleHumanScroll({ segments: 0 }, collector));
    expect(parseJson<BrowserStatusResponse>(result)).toMatchObject({ success: true, segments: 1 });

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() => handleHumanScroll({ segments: 999 }, c2));
    expect(parseJson<BrowserStatusResponse>(result2)).toMatchObject({
      success: true,
      segments: 200,
    });
  }, 30_000);

  it('derives pauseMs from durationMs when pauseMs is omitted', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanScroll({ distance: 200, durationMs: 900, segments: 3 }, collector),
    );
    expect(parseJson<BrowserStatusResponse>(result)).toMatchObject({
      success: true,
      durationMs: 900,
      pauseMs: 300,
      segments: 3,
    });
  });

  it('scrolls and reports success', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanScroll({ distance: 300, direction: 'down', segments: 2 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    expect(parsed.success).toBe(true);
    expect(parsed.direction).toBe('down');
    expect(parsed.actualScrolled).toBeGreaterThan(0);
  });
});

describe('handleHumanTyping', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns failure when no active page', async () => {
    const { collector } = createMockCollector(false);
    const result = await handleHumanTyping({ selector: '#input', text: 'hi' }, collector);
    const body = parseJson<BrowserStatusResponse>(result);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/No active page/);
  });

  it('requires selector and text', async () => {
    const { collector } = createMockCollector(true);
    const result = await handleHumanTyping({}, collector);
    const body = parseJson<BrowserStatusResponse>(result);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/selector.*text/i);
  });

  it('clamps wpm to [10, 300]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'a', wpm: 1 }, collector),
    );
    expect(parseJson<BrowserStatusResponse>(result)).toMatchObject({ success: true, wpm: 10 });

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'a', wpm: 999 }, c2),
    );
    expect(parseJson<BrowserStatusResponse>(result2)).toMatchObject({ success: true, wpm: 300 });
  });

  it('clamps errorRate to [0, 0.3]', async () => {
    const { collector } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'a', errorRate: -1 }, collector),
    );
    expect(parseJson<BrowserStatusResponse>(result)).toMatchObject({ success: true, errorRate: 0 });

    const { collector: c2 } = createMockCollector(true);
    const result2 = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'a', errorRate: 0.9 }, c2),
    );
    expect(parseJson<BrowserStatusResponse>(result2)).toMatchObject({
      success: true,
      errorRate: 0.3,
    });
  });

  it('types text and reports success', async () => {
    const { collector, keyboard } = createMockCollector(true);
    const result = await runWithFakeTimers(() =>
      handleHumanTyping({ selector: '#in', text: 'hi', errorRate: 0 }, collector),
    );
    const parsed = parseJson<BrowserStatusResponse>(result);
    expect(parsed.success).toBe(true);
    expect(parsed.length).toBe(2);
    expect(keyboard.type).toHaveBeenCalled();
  });
});
