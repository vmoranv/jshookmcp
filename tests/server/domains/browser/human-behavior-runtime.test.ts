import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleHumanMouse,
  handleHumanScroll,
  handleHumanTyping,
} from '@server/domains/browser/handlers/human-behavior';

function createCollector(page: any) {
  return {
    getActivePage: vi.fn(async () => page),
  } as any;
}

function createPage(documentOverride: Record<string, any> = {}) {
  const document = {
    body: {},
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    getElementById: vi.fn(() => null),
    ...documentOverride,
  };
  return {
    mouse: {
      move: vi.fn(),
      click: vi.fn(),
    },
    keyboard: {
      type: vi.fn(),
      press: vi.fn(),
    },
    click: vi.fn(),
    evaluate: vi.fn(async (pageFunction: any, ...args: any[]) => {
      const prevDocument = (globalThis as any).document;
      (globalThis as any).document = document;
      try {
        return await pageFunction(...args);
      } finally {
        (globalThis as any).document = prevDocument;
      }
    }),
    url: vi.fn(() => 'http://test.local'),
    document,
  };
}

async function runWithFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const promise = fn();
  await vi.runAllTimersAsync();
  const result = await promise;
  vi.useRealTimers();
  return result;
}

describe('human-behavior runtime coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('covers mouse curve variants', async () => {
    const page = createPage();
    const collector = createCollector(page);

    for (const curve of ['linear', 'ease-in', 'ease-out'] as const) {
      const result = await runWithFakeTimers(() =>
        handleHumanMouse({ toX: 50, toY: 60, steps: 1, curve }, collector),
      );
      expect(parseJson<any>(result).success).toBe(true);
    }

    expect(page.mouse.move).toHaveBeenCalled();
  });

  it('scrolls horizontally through a selector', async () => {
    const scrollBy = vi.fn();
    const page = createPage({
      querySelector: vi.fn((selector: string) => (selector === '#pane' ? { scrollBy } : null)),
    });
    const collector = createCollector(page);

    const result = await runWithFakeTimers(() =>
      handleHumanScroll(
        {
          selector: '#pane',
          direction: 'right',
          distance: 300,
          segments: 1,
          pauseMs: 0,
        },
        collector,
      ),
    );
    const parsed = parseJson<any>(result);

    expect(parsed.success).toBe(true);
    expect(parsed.direction).toBe('right');
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ left: expect.any(Number), top: 0 });
  });

  it('clears the field and simulates typos while typing punctuation', async () => {
    const page = createPage({
      querySelector: vi.fn(() => ({ value: 'old' })),
    });
    const collector = createCollector(page);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const result = await runWithFakeTimers(() =>
      handleHumanTyping(
        {
          selector: '#input',
          text: 'a!',
          clearFirst: true,
          errorRate: 1,
          correctDelayMs: 50,
          wpm: 60,
        },
        collector,
      ),
    );
    const parsed = parseJson<any>(result);

    expect(parsed.success).toBe(true);
    expect(parsed.typosSimulated).toBe(2);
    expect(page.click).toHaveBeenCalledWith('#input');
    expect(page.evaluate).toHaveBeenCalled();
    expect(page.keyboard.press).toHaveBeenCalledWith('Backspace');
    expect(page.keyboard.type).toHaveBeenCalled();
  });
});
