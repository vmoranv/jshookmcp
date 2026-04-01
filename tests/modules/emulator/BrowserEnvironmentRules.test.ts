import { describe, it, expect } from 'vitest';
import { BrowserEnvironmentRulesManager } from '@modules/emulator/BrowserEnvironmentRules';

describe('BrowserEnvironmentRulesManager', () => {
  it('loads default rules and exposes lookups', () => {
    const manager = new BrowserEnvironmentRulesManager();
    const webdriverRule = manager.getRule('navigator.webdriver');

    expect(webdriverRule).toBeDefined();
    expect(webdriverRule?.required).toBe(true);
    expect(webdriverRule?.defaultValue).toBe(false);
  });

  it('returns category-specific rules', () => {
    const manager = new BrowserEnvironmentRulesManager();
    const navigatorRules = manager.getRulesByCategory('navigator');

    expect(navigatorRules.length).toBeGreaterThan(5);
    expect(navigatorRules.some((r) => r.path === 'navigator.userAgent')).toBe(true);
  });

  it('supports runtime rule registration', () => {
    const manager = new BrowserEnvironmentRulesManager();
    manager.addRule({
      path: 'window.__custom',
      category: 'window',
      type: 'string',
      defaultValue: 'ok',
    });

    expect(manager.getRule('window.__custom')?.defaultValue).toBe('ok');
  });

  it('evaluates function-based default values for userAgent rule', () => {
    const manager = new BrowserEnvironmentRulesManager();
    const rule = manager.getRule('navigator.userAgent');
    const value =
      typeof rule?.defaultValue === 'function'
        ? rule.defaultValue('chrome' as any, '120.0-test')
        : '';

    expect(typeof value).toBe('string');
    expect(String(value)).toContain('120.0-test');
  });

  it('exports and reloads rules/config JSON', () => {
    const manager = new BrowserEnvironmentRulesManager();
    manager.addRule({
      path: 'navigator.__restored',
      category: 'navigator',
      type: 'boolean',
      defaultValue: true,
    });
    const json = manager.exportToJSON();

    const restored = new BrowserEnvironmentRulesManager();
    restored.loadFromJSON(json);

    expect(restored.getRule('navigator.__restored')?.defaultValue).toBe(true);
    expect(restored.getRule('location.href')).toBeDefined();
  });

  it('evaluates function and generated default values for performance and crypto rules', () => {
    const manager = new BrowserEnvironmentRulesManager();

    const platformRule = manager.getRule('navigator.platform');
    const vendorRule = manager.getRule('navigator.vendor');
    const navStartRule = manager.getRule('performance.timing.navigationStart');
    const loadEndRule = manager.getRule('performance.timing.loadEventEnd');
    const randomValuesRule = manager.getRule('crypto.getRandomValues');

    expect(
      typeof platformRule?.defaultValue === 'function'
        ? platformRule.defaultValue('chrome' as any, '120.0-test')
        : undefined,
    ).toBe('Win32');
    expect(
      typeof vendorRule?.defaultValue === 'function'
        ? vendorRule.defaultValue('chrome' as any, '120.0-test')
        : undefined,
    ).toBe('Google Inc.');

    const navStartValue =
      typeof navStartRule?.defaultValue === 'function'
        ? navStartRule.defaultValue('chrome' as any, '120.0-test')
        : undefined;
    const loadEndValue =
      typeof loadEndRule?.defaultValue === 'function'
        ? loadEndRule.defaultValue('chrome' as any, '120.0-test')
        : undefined;

    expect(typeof navStartValue).toBe('number');
    expect(typeof loadEndValue).toBe('number');
    expect(randomValuesRule?.defaultValue?.([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
