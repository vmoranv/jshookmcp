import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { getProjectRoot } from '@utils/outputPaths';

describe('config utilities', () => {
  const originalEnv = { ...process.env };

  const mockMissingEnvFile = () => {
    const missingEnvError = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT',
    });
    vi.doMock('dotenv', () => ({
      config: () => ({ error: missingEnvError }),
    }));
  };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.MCP_SERVER_NAME;
    delete process.env.MCP_SERVER_VERSION;
    delete process.env.PUPPETEER_HEADLESS;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.BROWSER_EXECUTABLE_PATH;
    delete process.env.CACHE_DIR;
    delete process.env.MAX_CONCURRENT_ANALYSIS;
    delete process.env.MAX_CODE_SIZE_MB;
    delete process.env.SEARCH_QUERY_CATEGORY_PROFILES_JSON;
    delete process.env.SEARCH_CJK_QUERY_ALIASES_JSON;
    delete process.env.SEARCH_INTENT_TOOL_BOOST_RULES_JSON;
    mockMissingEnvFile();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns sane defaults when environment is empty', async () => {
    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    expect(config.mcp.name).toBe('jshookmcp');
    expect(config.mcp.version.length).toBeGreaterThan(0);
    expect(config.puppeteer.timeout).toBe(30000);
    expect(config.cache.ttl).toBe(3600);
    expect(config.performance.maxConcurrentAnalysis).toBe(3);
    expect(config.search.queryCategoryProfiles.length).toBeGreaterThan(0);
    expect(config.search.cjkQueryAliases.length).toBeGreaterThan(0);
    expect(config.search.intentToolBoostRules.length).toBeGreaterThan(0);
  });

  it('reads MCP server metadata from environment', async () => {
    process.env.MCP_SERVER_NAME = 'custom-server';
    process.env.MCP_SERVER_VERSION = '9.9.9';

    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    expect(config.mcp.name).toBe('custom-server');
    expect(config.mcp.version).toBe('9.9.9');
  });

  it('resolves executable path by priority order', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = 'browser-path';
    process.env.PUPPETEER_EXECUTABLE_PATH = 'puppeteer-path';

    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    expect(config.puppeteer.executablePath).toBe('puppeteer-path');
  });

  it('parses boolean headless flag correctly', async () => {
    const { getConfig } = await import('@utils/config');
    process.env.PUPPETEER_HEADLESS = 'true';
    expect(getConfig().puppeteer.headless).toBe(true);

    process.env.PUPPETEER_HEADLESS = 'false';
    expect(getConfig().puppeteer.headless).toBe(false);
  });

  it('resolves relative cache directory against project root', async () => {
    process.env.CACHE_DIR = '.cache/custom';
    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    expect(config.cache.dir).toBe(join(getProjectRoot(), '.cache/custom'));
  });

  it('validateConfig reports invalid performance settings', async () => {
    const { getConfig, validateConfig } = await import('@utils/config');
    const config = getConfig();
    config.performance.maxConcurrentAnalysis = 0;
    config.performance.maxCodeSizeMB = 0;

    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('maxConcurrentAnalysis must be at least 1');
    expect(result.errors).toContain('maxCodeSizeMB must be at least 1');
  });

  it('reads search rule overrides from environment json', async () => {
    process.env.SEARCH_QUERY_CATEGORY_PROFILES_JSON = JSON.stringify([
      {
        pattern: 'custom-query',
        flags: 'i',
        domainBoosts: [{ domain: 'browser', weight: 2 }],
      },
    ]);
    process.env.SEARCH_CJK_QUERY_ALIASES_JSON = JSON.stringify([
      {
        pattern: '自定义',
        tokens: ['custom-token'],
      },
    ]);
    process.env.SEARCH_INTENT_TOOL_BOOST_RULES_JSON = JSON.stringify([
      {
        pattern: '自定义流程',
        flags: 'i',
        boosts: [{ tool: 'run_extension_workflow', bonus: 99 }],
      },
    ]);

    const { getConfig } = await import('@utils/config');
    const config = getConfig();

    expect(config.search.queryCategoryProfiles).toEqual([
      {
        pattern: 'custom-query',
        flags: 'i',
        domainBoosts: [{ domain: 'browser', weight: 2 }],
      },
    ]);
    expect(config.search.cjkQueryAliases).toEqual([
      {
        pattern: '自定义',
        flags: undefined,
        tokens: ['custom-token'],
      },
    ]);
    expect(config.search.intentToolBoostRules).toEqual([
      {
        pattern: '自定义流程',
        flags: 'i',
        boosts: [{ tool: 'run_extension_workflow', bonus: 99 }],
      },
    ]);
  });
});
