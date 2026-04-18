import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfig, validateConfig } from '@utils/config';

describe('config validation – extended checks', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PUPPETEER_TIMEOUT;
    delete process.env.CACHE_TTL;
    delete process.env.MAX_CONCURRENT_ANALYSIS;
    delete process.env.MAX_CODE_SIZE_MB;
    delete process.env.SEARCH_QUERY_CATEGORY_PROFILES_JSON;
    delete process.env.SEARCH_CJK_QUERY_ALIASES_JSON;
    delete process.env.SEARCH_INTENT_TOOL_BOOST_RULES_JSON;
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

  it('falls back to default search config when search json is invalid', () => {
    process.env.SEARCH_QUERY_CATEGORY_PROFILES_JSON = '{bad-json';
    process.env.SEARCH_CJK_QUERY_ALIASES_JSON = '{"bad":"json"}';
    process.env.SEARCH_INTENT_TOOL_BOOST_RULES_JSON = '{still-bad-json';

    const config = getConfig();

    expect(config.search.queryCategoryProfiles.length).toBeGreaterThan(0);
    expect(config.search.cjkQueryAliases.length).toBeGreaterThan(0);
    expect(config.search.intentToolBoostRules.length).toBeGreaterThan(0);
  });

  it('validateConfig reports invalid search regex patterns', () => {
    const config = getConfig();
    config.search.queryCategoryProfiles[0]!.pattern = '[invalid';
    config.search.intentToolBoostRules[0]!.pattern = '[invalid';

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'search.queryCategoryProfiles contains invalid regex: [invalid',
    );
    expect(result.errors).toContain('search.intentToolBoostRules contains invalid regex: [invalid');
  });
});
