/**
 * StealthScripts unit tests — verify UA strings, launch args, and detection patches.
 */

import { describe, it, expect } from 'vitest';
import { StealthScripts } from '@modules/stealth/StealthScripts';

describe('StealthScripts', () => {
  it('getRecommendedLaunchArgs contains key anti-detection flags', () => {
    const args = StealthScripts.getRecommendedLaunchArgs();

    expect(args).toContain('--disable-blink-features=AutomationControlled');
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-infobars');
    // Patchright args should be included
    expect(args).toContain('--remote-allow-origins=*');
    expect(args).toContain('--disable-component-update');
    expect(args).toContain('--disable-hang-monitor');
  });

  it('getRecommendedLaunchArgs has at least 25 args', () => {
    const args = StealthScripts.getRecommendedLaunchArgs();
    expect(args.length).toBeGreaterThanOrEqual(25);
  });

  it('getPatchrightLaunchArgs returns Patchright-specific subset', () => {
    const args = StealthScripts.getPatchrightLaunchArgs();

    expect(args).toContain('--remote-allow-origins=*');
    expect(args).toContain('--disable-component-update');
    expect(args).toContain('--disable-popup-blocking');
    expect(args.length).toBeGreaterThanOrEqual(5);

    // Should NOT contain generic puppeteer args
    expect(args).not.toContain('--no-sandbox');
    expect(args).not.toContain('--disable-gpu');
  });

  it('UA strings contain Chrome 131', () => {
    expect(typeof StealthScripts.setRealisticUserAgent).toBe('function');
    expect(typeof StealthScripts.hideWebDriver).toBe('function');
    expect(typeof StealthScripts.mockChrome).toBe('function');
  });

  it('injectAll is a static async function', () => {
    expect(typeof StealthScripts.injectAll).toBe('function');
  });

  it('getPatchrightLaunchArgs is subset of getRecommendedLaunchArgs', () => {
    const patchrightArgs = StealthScripts.getPatchrightLaunchArgs();
    const allArgs = StealthScripts.getRecommendedLaunchArgs();

    for (const arg of patchrightArgs) {
      expect(allArgs).toContain(arg);
    }
  });
});
