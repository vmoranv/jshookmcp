/**
 * StealthVerifier coverage tests — cover the page.evaluate callback body
 * and all recommendation branches.
 *
 * The evaluate callback runs in a browser context. Since we're in Node,
 * we capture the function passed to page.evaluate() and invoke it ourselves
 * against a simulated browser-like global environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StealthVerifier } from '../../../src/modules/stealth/StealthVerifier';
import type { Page } from 'rebrowser-puppeteer-core';

// ── helpers ────────────────────────────────────────────────────────────

function createMockPage(): Page & { evaluate: ReturnType<typeof vi.fn> } {
  return {
    evaluate: vi.fn(),
  } as unknown as Page & { evaluate: ReturnType<typeof vi.fn> };
}

function runInBrowserContext<T>(source: () => T, context: Record<string, unknown>): T | Promise<T> {
  const runner = new Function(
    'context',
    `with (context) {
      const fn = ${source.toString()};
      return fn();
    }`,
  );
  return runner(context) as T | Promise<T>;
}

function stubBrowserGlobals(context: {
  navigator: Record<string, unknown>;
  window: Record<string, unknown>;
  document: Record<string, unknown>;
  performance?: Record<string, unknown>;
  Notification?: Record<string, unknown>;
}) {
  context.window.navigator = context.navigator;
  vi.stubGlobal('navigator', context.navigator);
  vi.stubGlobal('window', context.window);
  vi.stubGlobal('document', context.document);
  vi.stubGlobal('performance', context.performance ?? {});
  vi.stubGlobal('Notification', context.Notification ?? { permission: 'granted' });
}

describe('StealthVerifier — full coverage', () => {
  let verifier: StealthVerifier;
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    verifier = new StealthVerifier();
    mockPage = createMockPage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── recommendation branches ────────────────────────────────────────

  describe('recommendation switch branches', () => {
    it('generates recommendation for navigator.webdriver failure', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'navigator.webdriver', passed: false, expected: 'undefined', actual: 'true' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain('Run stealth_inject to hide navigator.webdriver');
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.passedCount).toBe(0);
      expect(result.totalCount).toBe(1);
    });

    it('generates recommendation for window.chrome failure', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'window.chrome', passed: false, expected: 'object', actual: 'undefined' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain('Run stealth_inject to inject window.chrome object');
    });

    it('generates recommendation for chrome.app.isInstalled failure', async () => {
      mockPage.evaluate.mockResolvedValue([
        {
          name: 'chrome.app.isInstalled',
          passed: false,
          expected: 'exists (false)',
          actual: 'missing',
        },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain(
        'Update stealth scripts to include chrome.app structure',
      );
    });

    it('generates recommendation for navigator.plugins failure', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'navigator.plugins', passed: false, expected: '>= 3', actual: '0' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain('Run stealth_inject to restore navigator.plugins');
    });

    it('generates recommendation for platform/UA consistency failure', async () => {
      mockPage.evaluate.mockResolvedValue([
        {
          name: 'platform/UA consistency',
          passed: false,
          expected: 'consistent',
          actual: 'UA=Windows... platform=Mac',
        },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain(
        'Run stealth_set_user_agent with matching platform before stealth_inject',
      );
    });

    it('generates recommendation for cdc_ variables failure', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'cdc_ variables', passed: false, expected: 'none', actual: 'cdc_asdf' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain(
        'Run stealth_inject to clean up ChromeDriver cdc_ variables',
      );
    });

    it('generates generic Fix recommendation for unknown check names (default branch)', async () => {
      mockPage.evaluate.mockResolvedValue([
        {
          name: 'WebGL vendor',
          passed: false,
          expected: 'non-empty vendor string',
          actual: 'empty',
        },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain(
        'Fix: WebGL vendor — expected non-empty vendor string, got empty',
      );
    });

    it('generates generic Fix for navigator.languages (hits default)', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'navigator.languages', passed: false, expected: 'non-empty', actual: '[]' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain(
        'Fix: navigator.languages — expected non-empty, got []',
      );
    });

    it('generates generic Fix for hardwareConcurrency (hits default)', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'hardwareConcurrency', passed: false, expected: '>= 4', actual: '2' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain('Fix: hardwareConcurrency — expected >= 4, got 2');
    });

    it('generates generic Fix for deviceMemory (hits default)', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'deviceMemory', passed: false, expected: '>= 4', actual: 'undefined' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toContain('Fix: deviceMemory — expected >= 4, got undefined');
    });
  });

  // ── score calculation ─────────────────────────────────────────────

  describe('score calculation', () => {
    it('calculates partial score correctly', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'check1', passed: true, expected: 'a', actual: 'a' },
        { name: 'check2', passed: false, expected: 'b', actual: 'c' },
        { name: 'check3', passed: true, expected: 'd', actual: 'd' },
        { name: 'check4', passed: false, expected: 'e', actual: 'f' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.score).toBe(50); // 2/4 = 50
      expect(result.passedCount).toBe(2);
      expect(result.totalCount).toBe(4);
      expect(result.passed).toBe(false);
    });

    it('handles single check that passes', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'single', passed: true, expected: 'x', actual: 'x' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.score).toBe(100);
      expect(result.passed).toBe(true);
      expect(result.recommendations).toHaveLength(0);
    });

    it('handles all 10 checks failing', async () => {
      const allFailing = [
        { name: 'navigator.webdriver', passed: false, expected: 'undefined', actual: 'true' },
        { name: 'window.chrome', passed: false, expected: 'object', actual: 'undefined' },
        {
          name: 'chrome.app.isInstalled',
          passed: false,
          expected: 'exists (false)',
          actual: 'missing',
        },
        { name: 'navigator.plugins', passed: false, expected: '>= 3', actual: '0' },
        { name: 'navigator.languages', passed: false, expected: 'non-empty', actual: '[]' },
        {
          name: 'platform/UA consistency',
          passed: false,
          expected: 'consistent',
          actual: 'UA=... platform=Win32',
        },
        {
          name: 'WebGL vendor',
          passed: false,
          expected: 'non-empty vendor string',
          actual: 'empty',
        },
        { name: 'cdc_ variables', passed: false, expected: 'none', actual: 'cdc_asdf' },
        { name: 'hardwareConcurrency', passed: false, expected: '>= 4', actual: '2' },
        { name: 'deviceMemory', passed: false, expected: '>= 4', actual: 'undefined' },
      ];
      mockPage.evaluate.mockResolvedValue(allFailing);
      const result = await verifier.verify(mockPage);
      expect(result.score).toBe(0);
      expect(result.passedCount).toBe(0);
      expect(result.totalCount).toBe(10);
      expect(result.passed).toBe(false);
      expect(result.recommendations).toHaveLength(10);
    });

    it('rounds score to integer', async () => {
      // 1 out of 3 = 33.33... should round to 33
      mockPage.evaluate.mockResolvedValue([
        { name: 'a', passed: true, expected: 'x', actual: 'x' },
        { name: 'b', passed: false, expected: 'y', actual: 'z' },
        { name: 'c', passed: false, expected: 'y', actual: 'z' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.score).toBe(33);
    });
  });

  // ── no recommendations for passing checks ─────────────────────────

  describe('passing checks produce no recommendations', () => {
    it('does not add recommendations for passing checks', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'navigator.webdriver', passed: true, expected: 'undefined', actual: 'undefined' },
        { name: 'window.chrome', passed: true, expected: 'object', actual: 'object' },
        {
          name: 'chrome.app.isInstalled',
          passed: true,
          expected: 'exists (false)',
          actual: 'false',
        },
        { name: 'navigator.plugins', passed: true, expected: '>= 3', actual: '5' },
        {
          name: 'platform/UA consistency',
          passed: true,
          expected: 'consistent',
          actual: 'consistent',
        },
        { name: 'cdc_ variables', passed: true, expected: 'none', actual: 'none' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toHaveLength(0);
      expect(result.passed).toBe(true);
    });
  });

  // ── mixed pass/fail scenarios ─────────────────────────────────────

  describe('mixed pass and fail', () => {
    it('only generates recommendations for failed checks in a mixed set', async () => {
      mockPage.evaluate.mockResolvedValue([
        { name: 'navigator.webdriver', passed: true, expected: 'undefined', actual: 'undefined' },
        { name: 'window.chrome', passed: false, expected: 'object', actual: 'undefined' },
        { name: 'navigator.plugins', passed: true, expected: '>= 3', actual: '5' },
        { name: 'cdc_ variables', passed: false, expected: 'none', actual: 'cdc_xyz' },
      ]);
      const result = await verifier.verify(mockPage);
      expect(result.recommendations).toHaveLength(2);
      expect(result.recommendations).toContain('Run stealth_inject to inject window.chrome object');
      expect(result.recommendations).toContain(
        'Run stealth_inject to clean up ChromeDriver cdc_ variables',
      );
      expect(result.passedCount).toBe(2);
      expect(result.totalCount).toBe(4);
      expect(result.score).toBe(50);
    });
  });

  // ── evaluate callback returns structure ───────────────────────────

  describe('evaluate callback structure', () => {
    it('passes a function to page.evaluate', async () => {
      mockPage.evaluate.mockResolvedValue([]);
      await verifier.verify(mockPage);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      expect(typeof mockPage.evaluate.mock.calls[0]![0]).toBe('function');
    });

    it('result checks array is the same array returned by evaluate', async () => {
      const checks = [{ name: 'test', passed: true, expected: 'a', actual: 'a' }];
      mockPage.evaluate.mockResolvedValue(checks);
      const result = await verifier.verify(mockPage);
      expect(result.checks).toBe(checks);
    });
  });

  // ── real browser-context execution ───────────────────────────────

  describe('evaluate callback execution', () => {
    function makeContext(overrides: Record<string, unknown> = {}) {
      const navigator = {
        webdriver: undefined,
        plugins: { length: 5 },
        languages: ['en-US'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        hardwareConcurrency: 8,
        deviceMemory: 8,
      };

      const canvas = {
        getContext: vi.fn(() => ({
          getExtension: vi.fn(() => ({ UNMASKED_VENDOR_WEBGL: 1 })),
          getParameter: vi.fn(() => 'Google Inc.'),
        })),
      };

      const document = {
        createElement: vi.fn(() => canvas),
      };

      const window = {
        chrome: { app: { isInstalled: false } },
      };

      return {
        navigator,
        document,
        window,
        performance: {},
        Notification: { permission: 'granted' },
        ...overrides,
      };
    }

    it('executes the browser checks in a passing Windows environment', async () => {
      mockPage.evaluate.mockImplementation(async (fn: () => unknown) =>
        runInBrowserContext(fn, makeContext()),
      );

      const result = await verifier.verify(mockPage);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.passedCount).toBe(10);
      expect(result.totalCount).toBe(10);
      expect(result.recommendations).toHaveLength(0);
      expect(result.checks.find((check) => check.name === 'WebGL vendor')?.passed).toBe(true);
    });

    it('flags Mac UA/platform mismatches while still executing the callback body', async () => {
      mockPage.evaluate.mockImplementation(async (fn: () => unknown) =>
        runInBrowserContext(
          fn,
          makeContext({
            navigator: {
              webdriver: undefined,
              plugins: { length: 5 },
              languages: ['en-US'],
              userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
              platform: 'Win32',
              hardwareConcurrency: 8,
              deviceMemory: 8,
            },
          }),
        ),
      );

      const result = await verifier.verify(mockPage);

      expect(result.checks.find((check) => check.name === 'platform/UA consistency')?.passed).toBe(
        false,
      );
      expect(result.recommendations).toContain(
        'Run stealth_set_user_agent with matching platform before stealth_inject',
      );
    });

    it('handles Linux UA and WebGL failure paths', async () => {
      mockPage.evaluate.mockImplementation(async (fn: () => unknown) =>
        runInBrowserContext(
          fn,
          makeContext({
            navigator: {
              webdriver: undefined,
              plugins: { length: 5 },
              languages: ['en-US'],
              userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
              platform: 'Win32',
              hardwareConcurrency: 8,
              deviceMemory: 8,
            },
            window: {},
            document: {
              createElement: vi.fn(() => {
                throw new Error('canvas blocked');
              }),
            },
          }),
        ),
      );

      const result = await verifier.verify(mockPage);

      expect(result.checks.find((check) => check.name === 'WebGL vendor')?.actual).toBe('error');
      expect(result.checks.find((check) => check.name === 'window.chrome')?.passed).toBe(false);
      expect(result.recommendations).toContain('Run stealth_inject to inject window.chrome object');
    });
  });

  // ── empty checks array edge case ─────────────────────────────────

  describe('edge cases', () => {
    it('handles empty checks array gracefully', async () => {
      mockPage.evaluate.mockResolvedValue([]);
      const result = await verifier.verify(mockPage);
      // 0/0 = NaN, but Math.round(NaN) = NaN — verify behavior
      expect(result.passedCount).toBe(0);
      expect(result.totalCount).toBe(0);
      expect(result.passed).toBe(true); // 0 === 0
      expect(result.recommendations).toHaveLength(0);
    });
  });

  describe('real callback execution', () => {
    it('executes the original callback in a passing Windows environment', async () => {
      const navigator = {
        webdriver: undefined,
        plugins: { length: 5 },
        languages: ['en-US', 'en'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        hardwareConcurrency: 8,
        deviceMemory: 8,
      } as Record<string, unknown>;
      const document = {
        createElement: vi.fn(() => ({
          getContext: vi.fn(() => ({
            getExtension: vi.fn(() => ({ UNMASKED_VENDOR_WEBGL: 1 })),
            getParameter: vi.fn(() => 'Google Inc.'),
          })),
        })),
      } as Record<string, unknown>;
      const window = {
        chrome: { app: { isInstalled: false } },
      } as Record<string, unknown>;

      stubBrowserGlobals({
        navigator,
        window,
        document,
      });

      mockPage.evaluate.mockImplementation(async (fn: () => unknown) => fn());

      const result = await verifier.verify(mockPage);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.passedCount).toBe(10);
      expect(result.totalCount).toBe(10);
      expect(result.recommendations).toHaveLength(0);
      expect(result.checks.find((check) => check.name === 'WebGL vendor')?.actual).toBe(
        'Google Inc.',
      );
    });

    it('treats navigator.webdriver=false as passing', async () => {
      const navigator = {
        webdriver: false,
        plugins: { length: 5 },
        languages: ['en-US'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        hardwareConcurrency: 8,
        deviceMemory: 8,
      } as Record<string, unknown>;
      const document = {
        createElement: vi.fn(() => ({
          getContext: vi.fn(() => ({
            getExtension: vi.fn(() => ({ UNMASKED_VENDOR_WEBGL: 1 })),
            getParameter: vi.fn(() => 'Google Inc.'),
          })),
        })),
      } as Record<string, unknown>;
      const window = {
        chrome: { app: { isInstalled: false } },
      } as Record<string, unknown>;

      stubBrowserGlobals({
        navigator,
        window,
        document,
      });

      mockPage.evaluate.mockImplementation(async (fn: () => unknown) => fn());

      const result = await verifier.verify(mockPage);

      expect(result.checks.find((check) => check.name === 'navigator.webdriver')?.passed).toBe(
        true,
      );
      expect(result.passed).toBe(true);
    });

    it('flags a Windows UA with a non-Windows platform and other mismatches', async () => {
      const navigator = {
        webdriver: true,
        plugins: { length: 0 },
        languages: [],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'MacIntel',
        hardwareConcurrency: 2,
        deviceMemory: undefined,
      } as Record<string, unknown>;
      const document = {
        cdc_123: true,
        createElement: vi.fn(() => {
          throw new Error('Canvas error');
        }),
      } as Record<string, unknown>;
      const window = {
        chrome: null,
      } as Record<string, unknown>;

      stubBrowserGlobals({
        navigator,
        window,
        document,
      });

      mockPage.evaluate.mockImplementation(async (fn: () => unknown) =>
        runInBrowserContext(fn, {
          navigator,
          window,
          document,
          performance: {},
          Notification: { permission: 'granted' },
        }),
      );

      const result = await verifier.verify(mockPage);

      expect(result.passed).toBe(false);
      expect(result.recommendations).toContain('Run stealth_inject to hide navigator.webdriver');
      expect(result.recommendations).toContain('Run stealth_inject to inject window.chrome object');
      expect(result.recommendations).toContain('Run stealth_inject to restore navigator.plugins');
      expect(result.recommendations).toContain(
        'Run stealth_inject to clean up ChromeDriver cdc_ variables',
      );
      expect(result.recommendations).toContain(
        'Run stealth_set_user_agent with matching platform before stealth_inject',
      );
      expect(result.recommendations).toContain(
        'Fix: WebGL vendor — expected non-empty vendor string, got error',
      );
      expect(result.recommendations).toContain('Fix: hardwareConcurrency — expected >= 4, got 2');
      expect(result.recommendations).toContain('Fix: deviceMemory — expected >= 4, got undefined');
    });

    it('flags Mac and Linux platform mismatches in separate runs', async () => {
      const baseDocument = {
        createElement: vi.fn(() => ({
          getContext: vi.fn(() => ({
            getExtension: vi.fn(() => ({ UNMASKED_VENDOR_WEBGL: 1 })),
            getParameter: vi.fn(() => 'Google Inc.'),
          })),
        })),
      } as Record<string, unknown>;

      const cases = [
        {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          platform: 'Win32',
          expected: 'Run stealth_set_user_agent with matching platform before stealth_inject',
        },
        {
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
          platform: 'Win32',
          expected: 'Run stealth_set_user_agent with matching platform before stealth_inject',
        },
      ];

      for (const testCase of cases) {
        const navigator = {
          webdriver: undefined,
          plugins: { length: 5 },
          languages: ['en-US'],
          userAgent: testCase.userAgent,
          platform: testCase.platform,
          hardwareConcurrency: 8,
          deviceMemory: 8,
        } as Record<string, unknown>;
        const document = {
          ...baseDocument,
          createElement: vi.fn(() => ({
            getContext: vi.fn(() => ({
              getExtension: vi.fn(() => ({ UNMASKED_VENDOR_WEBGL: 1 })),
              getParameter: vi.fn(() => 'Google Inc.'),
            })),
          })),
        } as Record<string, unknown>;
        const window = {
          chrome: { app: { isInstalled: false } },
        } as Record<string, unknown>;

        stubBrowserGlobals({
          navigator,
          window,
          document,
        });

        mockPage.evaluate.mockImplementation(async (fn: () => unknown) => fn());

        const result = await verifier.verify(mockPage);
        expect(result.recommendations).toContain(testCase.expected);
      }
    });
  });
});
