import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig, validateConfig } from '@utils/config';

describe('config validation – extended checks', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PUPPETEER_TIMEOUT;
    delete process.env.CACHE_TTL;
    delete process.env.MAX_CONCURRENT_ANALYSIS;
    delete process.env.MAX_CODE_SIZE_MB;
    delete process.env.MCP_BROWSER_SESSION_QUEUE_MAX_PENDING;
    delete process.env.MCP_BROWSER_SESSION_QUEUE_MAX_PENDING_PER_SESSION;
    delete process.env.MCP_BROWSER_SESSION_QUEUE_WAIT_TIMEOUT_MS;
    delete process.env.MCP_BROWSER_SESSION_SCHEDULER_QUANTUM_MS;
    delete process.env.MCP_BROWSER_SESSION_SCHEDULER_AGING_MS;
    delete process.env.MCP_BROWSER_SESSION_EXPECTED_CONCURRENCY;
    delete process.env.MCP_BROWSER_SESSION_RESERVED_PENDING_PER_SESSION;
    delete process.env.MCP_BROWSER_SESSION_COST_EWMA_ALPHA;
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

  it('maps the OTLP metric export interval, defaulting to 120s', async () => {
    // The interval is the metric ROW-VOLUME lever: one row per tool/outcome
    // per flush window. Default must stay in sync with
    // OtlpInstrumentation.DEFAULT_METRIC_EXPORT_INTERVAL_MS.
    vi.resetModules();
    delete process.env.JSHOOK_OTLP_METRIC_EXPORT_INTERVAL_MS;
    const defaulted = await import('@utils/config');
    expect(defaulted.getConfig().observability?.metricExportIntervalMs).toBe(120_000);

    vi.resetModules();
    process.env.JSHOOK_OTLP_METRIC_EXPORT_INTERVAL_MS = '300000';
    const overridden = await import('@utils/config');
    expect(overridden.getConfig().observability?.metricExportIntervalMs).toBe(300_000);

    // Out of range falls back to the default rather than exporting every 0ms.
    vi.resetModules();
    process.env.JSHOOK_OTLP_METRIC_EXPORT_INTERVAL_MS = '1';
    const clamped = await import('@utils/config');
    expect(clamped.getConfig().observability?.metricExportIntervalMs).toBe(120_000);
  });

  it('validates browser session scheduler limits', () => {
    const config = getConfig();
    config.mcp.browserSessionQueueMaxPending = 4;
    config.mcp.browserSessionQueueMaxPendingPerSession = 5;
    config.mcp.browserSessionQueueWaitTimeoutMs = 0;
    config.mcp.browserSessionSchedulerQuantumMs = 0;
    config.mcp.browserSessionSchedulerAgingMs = 0;
    config.mcp.browserSessionExpectedConcurrency = 0;
    config.mcp.browserSessionReservedPendingPerSession = -1;
    config.mcp.browserSessionCostEwmaAlpha = 2;

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'mcp.browserSessionQueueMaxPendingPerSession must not exceed ' +
        'mcp.browserSessionQueueMaxPending',
    );
    expect(result.errors).toContain('mcp.browserSessionQueueWaitTimeoutMs must be at least 1');
    expect(result.errors).toContain('mcp.browserSessionSchedulerQuantumMs must be at least 1');
    expect(result.errors).toContain('mcp.browserSessionSchedulerAgingMs must be at least 1');
    expect(result.errors).toContain('mcp.browserSessionExpectedConcurrency must be at least 1');
    expect(result.errors).toContain(
      'mcp.browserSessionReservedPendingPerSession must not be negative',
    );
    expect(result.errors).toContain(
      'mcp.browserSessionCostEwmaAlpha must be greater than 0 and at most 1',
    );
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
    expect(config.search.intentToolBoostRules).toEqual([]);
  });

  it('validateConfig reports invalid search regex patterns', () => {
    const config = getConfig();
    config.search.queryCategoryProfiles[0]!.pattern = '[invalid';
    config.search.intentToolBoostRules = [{ pattern: '[invalid', flags: 'i', boosts: [] }];

    const result = validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'search.queryCategoryProfiles contains invalid regex: [invalid',
    );
    expect(result.errors).toContain('search.intentToolBoostRules contains invalid regex: [invalid');
  });
});
