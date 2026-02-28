import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { getConfig, validateConfig } from '../../src/utils/config.js';
import { getProjectRoot } from '../../src/utils/outputPaths.js';

describe('config utilities', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DEFAULT_LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.PUPPETEER_HEADLESS;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.CHROME_PATH;
    delete process.env.BROWSER_EXECUTABLE_PATH;
    delete process.env.CACHE_DIR;
    delete process.env.MAX_CONCURRENT_ANALYSIS;
    delete process.env.MAX_CODE_SIZE_MB;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns sane defaults when environment is empty', () => {
    const config = getConfig();
    expect(config.llm.provider).toBe('openai');
    expect(config.puppeteer.timeout).toBe(30000);
    expect(config.cache.ttl).toBe(3600);
    expect(config.performance.maxConcurrentAnalysis).toBe(3);
  });

  it('reads provider and credentials from environment', () => {
    process.env.DEFAULT_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'k-anthropic';

    const config = getConfig();
    expect(config.llm.provider).toBe('anthropic');
    expect(config.llm.anthropic.apiKey).toBe('k-anthropic');
  });

  it('resolves executable path by priority order', () => {
    process.env.BROWSER_EXECUTABLE_PATH = 'browser-path';
    process.env.CHROME_PATH = 'chrome-path';
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

