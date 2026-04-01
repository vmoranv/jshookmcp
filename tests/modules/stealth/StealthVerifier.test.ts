import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StealthVerifier, type StealthCheck } from '../../../src/modules/stealth/StealthVerifier';
import { type Page } from 'rebrowser-puppeteer-core';

describe('StealthVerifier', () => {
  let verifier: StealthVerifier;
  let mockPage: any;

  beforeEach(() => {
    verifier = new StealthVerifier();
    mockPage = {
      evaluate: vi.fn(),
    } as unknown as Page;
  });

  it('should return a perfect score when all checks pass', async () => {
    const mockChecks: StealthCheck[] = [
      { name: 'navigator.webdriver', passed: true, expected: 'undefined', actual: 'undefined' },
      { name: 'window.chrome', passed: true, expected: 'object', actual: 'object' },
      { name: 'chrome.app.isInstalled', passed: true, expected: 'exists (false)', actual: 'false' },
      { name: 'navigator.plugins', passed: true, expected: '>= 3', actual: '5' },
      { name: 'navigator.languages', passed: true, expected: 'non-empty', actual: '["en-US"]' },
      {
        name: 'platform/UA consistency',
        passed: true,
        expected: 'consistent',
        actual: 'consistent',
      },
      {
        name: 'WebGL vendor',
        passed: true,
        expected: 'non-empty vendor string',
        actual: 'Google Inc.',
      },
      { name: 'cdc_ variables', passed: true, expected: 'none', actual: 'none' },
      { name: 'hardwareConcurrency', passed: true, expected: '>= 4', actual: '8' },
      { name: 'deviceMemory', passed: true, expected: '>= 4', actual: '8' },
    ];

    mockPage.evaluate.mockResolvedValue(mockChecks);

    const result = await verifier.verify(mockPage);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.passedCount).toBe(10);
    expect(result.totalCount).toBe(10);
    expect(result.recommendations).toHaveLength(0);
  });

  it('should provide correct recommendations for failed checks', async () => {
    const mockChecks: StealthCheck[] = [
      { name: 'navigator.webdriver', passed: false, expected: 'undefined', actual: 'true' },
      { name: 'window.chrome', passed: false, expected: 'object', actual: 'undefined' },
      {
        name: 'chrome.app.isInstalled',
        passed: false,
        expected: 'exists (false)',
        actual: 'missing',
      },
      { name: 'navigator.plugins', passed: false, expected: '>= 3', actual: '0' },
      {
        name: 'platform/UA consistency',
        passed: false,
        expected: 'consistent',
        actual: 'UA=... platform=Win32',
      },
      { name: 'cdc_ variables', passed: false, expected: 'none', actual: 'cdc_asdf' },
      { name: 'WebGL vendor', passed: false, expected: 'non-empty vendor string', actual: 'empty' },
      { name: 'hardwareConcurrency', passed: false, expected: '>= 4', actual: '2' },
    ];

    mockPage.evaluate.mockResolvedValue(mockChecks);

    const result = await verifier.verify(mockPage);

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.recommendations).toContain('Run stealth_inject to hide navigator.webdriver');
    expect(result.recommendations).toContain('Run stealth_inject to inject window.chrome object');
    expect(result.recommendations).toContain(
      'Update stealth scripts to include chrome.app structure',
    );
    expect(result.recommendations).toContain('Run stealth_inject to restore navigator.plugins');
    expect(result.recommendations).toContain(
      'Run stealth_set_user_agent with matching platform before stealth_inject',
    );
    expect(result.recommendations).toContain(
      'Run stealth_inject to clean up ChromeDriver cdc_ variables',
    );
    expect(result.recommendations).toContain(
      'Fix: WebGL vendor — expected non-empty vendor string, got empty',
    );
    expect(result.recommendations).toContain('Fix: hardwareConcurrency — expected >= 4, got 2');
  });

  it('should test the actual evaluate function logic (partial)', async () => {
    // This test actually calls the function passed to evaluate to cover the code inside it
    const _evaluateFn = mockPage.evaluate.mockImplementation(async (fn: any) => {
      // Create a mock browser environment
      const mockNavigator = {
        webdriver: false,
        plugins: { length: 5 },
        languages: ['en-US'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        hardwareConcurrency: 8,
        deviceMemory: 8,
      };

      const mockWindow = {
        chrome: { app: { isInstalled: false } },
      };

      const mockDocument = {
        createElement: vi.fn().mockReturnValue({
          getContext: vi.fn().mockReturnValue({
            getExtension: vi.fn().mockReturnValue({ UNMASKED_VENDOR_WEBGL: 1 }),
            getParameter: vi.fn().mockReturnValue('Google Inc.'),
          }),
        }),
      };

      // We wrap the function to inject our mocks
      const wrappedFn = new Function(
        'navigator',
        'window',
        'document',
        `
        return (${fn.toString()})();
      `,
      );

      return wrappedFn(mockNavigator, mockWindow, mockDocument);
    });

    const result = await verifier.verify(mockPage);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it('should handle WebGL errors gracefully', async () => {
    mockPage.evaluate.mockImplementation(async (fn: any) => {
      const mockNavigator = {
        webdriver: undefined,
        plugins: { length: 5 },
        languages: ['en-US'],
        userAgent: 'Mozilla/5.0',
        platform: 'Win32',
      };
      const mockWindow = { chrome: { app: { isInstalled: false } } };
      const mockDocument = {
        createElement: vi.fn().mockImplementation(() => {
          throw new Error('Canvas error');
        }),
      };

      const wrappedFn = new Function(
        'navigator',
        'window',
        'document',
        `
        return (${fn.toString()})();
      `,
      );

      return wrappedFn(mockNavigator, mockWindow, mockDocument);
    });

    const result = await verifier.verify(mockPage);
    const webglCheck = result.checks.find((c) => c.name === 'WebGL vendor');
    expect(webglCheck?.passed).toBe(false);
    expect(webglCheck?.actual).toBe('error');
  });
});
