import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createDefaultBrowserConfigs,
  generateUserAgentFromConfig,
  getPlatformFromConfig,
  getVendorFromConfig,
} from '@modules/emulator/BrowserEnvironmentConfigHelpers';

describe('BrowserEnvironmentConfigHelpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates default chrome and firefox configs with expected language and platform defaults', () => {
    const configs = createDefaultBrowserConfigs();

    expect(configs.get('chrome')?.language).toBe('zh-CN');
    expect(configs.get('chrome')?.platform).toBe('Win32');
    expect(configs.get('firefox')?.vendor).toBe('');
    expect(configs.get('firefox')?.languages).toContain('en-US');
  });

  it('derives user agent, platform and vendor from the selected config with sane fallbacks', () => {
    const configs = createDefaultBrowserConfigs();

    expect(generateUserAgentFromConfig('chrome', '131.0.1.2', configs)).toContain('131.0.1.2');
    expect(getPlatformFromConfig('chrome', configs)).toBe('Win32');
    expect(getVendorFromConfig('chrome', configs)).toBe('Google Inc.');
    expect(generateUserAgentFromConfig('safari' as any, '1.0.0.0', configs)).toBe('');
    expect(getPlatformFromConfig('safari' as any, configs)).toBe('Win32');
    expect(getVendorFromConfig('safari' as any, configs)).toBe('');
  });
});
