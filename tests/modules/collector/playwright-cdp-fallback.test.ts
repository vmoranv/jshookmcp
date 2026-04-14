import { describe, expect, it } from 'vitest';
import { normalizePlaywrightConnectEndpoint } from '@modules/collector/playwright-cdp-fallback';

describe('normalizePlaywrightConnectEndpoint', () => {
  it('preserves direct ws CDP endpoints with browser routing path', () => {
    expect(
      normalizePlaywrightConnectEndpoint('ws://127.0.0.1:9222/devtools/browser/instance-1'),
    ).toBe('ws://127.0.0.1:9222/devtools/browser/instance-1');
  });

  it('preserves secure ws CDP endpoints with browser routing path', () => {
    expect(
      normalizePlaywrightConnectEndpoint(
        'wss://cdp.example.com/devtools/browser/routed-browser-id',
      ),
    ).toBe('wss://cdp.example.com/devtools/browser/routed-browser-id');
  });

  it('leaves browserURL endpoints unchanged', () => {
    expect(normalizePlaywrightConnectEndpoint('http://127.0.0.1:9222')).toBe(
      'http://127.0.0.1:9222',
    );
  });
});
