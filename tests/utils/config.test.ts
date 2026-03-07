import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { getConfig, validateConfig } from '@utils/config';
import { getProjectRoot } from '@utils/outputPaths';

function getSupportedProviders(): string[] {
  return Object.keys(getConfig().llm).filter((key) => key !== 'provider');
}

describe('config utilities', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DEFAULT_LLM_PROVIDER;
    delete process.env.PUPPETEER_HEADLESS;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.BROWSER_EXECUTABLE_PATH;
    delete process.env.CACHE_DIR;
    delete process.env.MAX_CONCURRENT_ANALYSIS;
    delete process.env.MAX_CODE_SIZE_MB;
    for (const provider of getSupportedProviders()) {
      delete process.env[`${provider.toUpperCase()}_API_KEY`];
      delete process.env[`${provider.toUpperCase()}_MODEL`];
      delete process.env[`${provider.toUpperCase()}_BASE_URL`];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns sane defaults when environment is empty', () => {
    const config = getConfig();
    expect(typeof config.llm.provider).toBe('string');
    expect(config.llm.provider.length).toBeGreaterThan(0);
    expect(config.puppeteer.timeout).toBe(30000);
    expect(config.cache.ttl).toBe(3600);
    expect(config.performance.maxConcurrentAnalysis).toBe(3);
  });

  it('reads provider and credentials from environment', () => {
    const defaultProvider = getConfig().llm.provider;
    const alternateProvider = getSupportedProviders().find((provider) => provider !== defaultProvider)!;
    process.env.DEFAULT_LLM_PROVIDER = alternateProvider;
    process.env[`${alternateProvider.toUpperCase()}_API_KEY`] = 'k-provider';

    const config = getConfig();
    expect(config.llm.provider).toBe(alternateProvider);
    expect((config.llm as Record<string, any>)[alternateProvider].apiKey).toBe('k-provider');
  });

  it('resolves executable path by priority order', () => {
    process.env.BROWSER_EXECUTABLE_PATH = 'browser-path';
    process.env.PUPPETEER_EXECUTABLE_PATH = 'puppeteer-path';

    const config = getConfig();
    expect(config.puppeteer.executablePath).toBe('puppeteer-path');
  });

  it('parses boolean headless flag correctly', () => {
    process.env.PUPPETEER_HEADLESS = 'true';
    expect(getConfig().puppeteer.headless).toBe(true);

    process.env.PUPPETEER_HEADLESS = 'false';
    expect(getConfig().puppeteer.headless).toBe(false);
  });

  it('resolves relative cache directory against project root', () => {
    process.env.CACHE_DIR = '.cache/custom';
    const config = getConfig();
    expect(config.cache.dir).toBe(join(getProjectRoot(), '.cache/custom'));
  });

  it('validateConfig reports invalid performance settings', () => {
    const config = getConfig();
    config.performance.maxConcurrentAnalysis = 0;
    config.performance.maxCodeSizeMB = 0;

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('maxConcurrentAnalysis must be at least 1');
    expect(result.errors).toContain('maxCodeSizeMB must be at least 1');
  });
});

