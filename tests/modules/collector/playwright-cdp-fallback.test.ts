import { describe, expect, it } from 'vitest';
import { normalizePlaywrightConnectEndpoint } from '@modules/collector/playwright-cdp-fallback';
import { TEST_WS_URLS, withPath } from '@tests/shared/test-urls';

describe('normalizePlaywrightConnectEndpoint', () => {
  it('preserves direct ws CDP endpoints with browser routing path', () => {
    expect(
      normalizePlaywrightConnectEndpoint('ws://127.0.0.1:9222/devtools/browser/instance-1'),
    ).toBe('ws://127.0.0.1:9222/devtools/browser/instance-1');
  });

  it('preserves secure ws CDP endpoints with browser routing path', () => {
    expect(
      normalizePlaywrightConnectEndpoint(
        withPath(TEST_WS_URLS.cdp, 'devtools/browser/routed-browser-id'),
      ),
    ).toBe(withPath(TEST_WS_URLS.cdp, 'devtools/browser/routed-browser-id'));
  });

  it('leaves browserURL endpoints unchanged', () => {
    expect(normalizePlaywrightConnectEndpoint('http://127.0.0.1:9222')).toBe(
      'http://127.0.0.1:9222',
    );
  });
});
