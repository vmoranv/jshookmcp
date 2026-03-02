import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfig, validateConfig } from '../../src/utils/config.js';

describe('config validation – extended checks', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DEFAULT_LLM_PROVIDER;
    delete process.env.PUPPETEER_TIMEOUT;
    delete process.env.CACHE_TTL;
    delete process.env.MAX_CONCURRENT_ANALYSIS;
    delete process.env.MAX_CODE_SIZE_MB;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('validates puppeteer timeout lower bound', () => {
    const config = getConfig();
    config.puppeteer.timeout = 100;
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('puppeteer.timeout must be at least 1000ms');
  });

  it('validates cache ttl non-negative', () => {
    const config = getConfig();
    config.cache.ttl = -1;
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('cache.ttl must be non-negative');
  });

  it('passes validation with correct defaults', () => {
    const config = getConfig();
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('Zod schema provides fallback when env has invalid values', () => {
    // Invalid: non-numeric timeout
    process.env.PUPPETEER_TIMEOUT = 'not-a-number';
    // Should not crash — graceful fallback
    const config = getConfig();
    expect(typeof config.puppeteer.timeout).toBe('number');
  });

  it('reads custom MAX_CONCURRENT_ANALYSIS from env', () => {
    process.env.MAX_CONCURRENT_ANALYSIS = '8';
    const config = getConfig();
    expect(config.performance.maxConcurrentAnalysis).toBe(8);
  });
});
