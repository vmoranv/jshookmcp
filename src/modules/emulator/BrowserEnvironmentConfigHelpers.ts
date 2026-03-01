import type { BrowserType, BrowserConfig } from './BrowserEnvironmentRules.js';

export function createDefaultBrowserConfigs(): Map<BrowserType, BrowserConfig> {
  const configs = new Map<BrowserType, BrowserConfig>();

  configs.set('chrome', {
    type: 'chrome',
    version: '120.0.0.0',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Win32',
    vendor: 'Google Inc.',
    language: 'zh-CN',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    screenWidth: 1920,
    screenHeight: 1080,
    colorDepth: 24,
    pixelRatio: 1,
  });

  configs.set('firefox', {
    type: 'firefox',
    version: '121.0',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    platform: 'Win32',
    vendor: '',
    language: 'zh-CN',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    screenWidth: 1920,
    screenHeight: 1080,
    colorDepth: 24,
    pixelRatio: 1,
  });

  return configs;
}

export function generateUserAgentFromConfig(
  browser: BrowserType,
  version: string,
  browserConfigs: Map<BrowserType, BrowserConfig>
): string {
  const config = browserConfigs.get(browser);
  if (config) {
    return config.userAgent.replace(/\d+\.\d+\.\d+\.\d+/, version);
  }
  return '';
}

export function getPlatformFromConfig(
  browser: BrowserType,
  browserConfigs: Map<BrowserType, BrowserConfig>
): string {
  const config = browserConfigs.get(browser);
  return config?.platform || 'Win32';
}

export function getVendorFromConfig(
  browser: BrowserType,
  browserConfigs: Map<BrowserType, BrowserConfig>
): string {
  const config = browserConfigs.get(browser);
  return config?.vendor || '';
}
