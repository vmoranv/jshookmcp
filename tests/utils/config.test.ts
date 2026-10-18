import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { getProjectRoot } from '@utils/outputPaths';

const { dotenvMock } = vi.hoisted(() => ({
  dotenvMock: {
    config: vi.fn(() => ({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })),
  },
}));

vi.mock('dotenv', () => dotenvMock);

describe('config utilities', () => {
  const originalEnv = { ...process.env };

  const mockMissingEnvFile = () => {
    dotenvMock.config.mockReturnValue({
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
  };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    dotenvMock.config.mockClear();
    delete process.env.MCP_SERVER_NAME;
    delete process.env.MCP_SERVER_VERSION;
    delete process.env.MCP_BROWSER_SESSION_QUEUE_MAX_PENDING;
    delete process.env.MCP_BROWSER_SESSION_QUEUE_MAX_PENDING_PER_SESSION;
    delete process.env.MCP_BROWSER_SESSION_QUEUE_WAIT_TIMEOUT_MS;
    delete process.env.MCP_BROWSER_SESSION_SCHEDULER_QUANTUM_MS;
    delete process.env.MCP_BROWSER_SESSION_SCHEDULER_AGING_MS;
    delete process.env.MCP_BROWSER_SESSION_EXPECTED_CONCURRENCY;
    delete process.env.MCP_BROWSER_SESSION_RESERVED_PENDING_PER_SESSION;
    delete process.env.MCP_BROWSER_SESSION_COST_EWMA_ALPHA;
    delete process.env.MCP_BROWSER_FLEET_WORKER_ID;
    delete process.env.MCP_BROWSER_FLEET_WORKERS_JSON;
    delete process.env.MCP_BROWSER_FLEET_VIRTUAL_NODES;
    delete process.env.MCP_BROWSER_FLEET_LEASE_TTL_MS;
    delete process.env.MCP_BROWSER_FLEET_MAX_LOCAL_LEASES;
    delete process.env.PUPPETEER_HEADLESS;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.BROWSER_EXECUTABLE_PATH;
    delete process.env.CACHE_DIR;
    delete process.env.MAX_CONCURRENT_ANALYSIS;
    delete process.env.MAX_CODE_SIZE_MB;
    delete process.env.APK_STATIC_TRIAGE_DEFAULT_ENTRIES;
    delete process.env.DEX_MAGIC_ASCII;
    delete process.env.FRIDA_DEX_DUMP_TIMEOUT_MS;
    delete process.env.NEMU_RAW_MEMORY_MAX_BYTES;
    delete process.env.REVERSE_SESSION_RUN_MAX_STEPS;
    delete process.env.TRANSFORM_WORKBENCH_MAX_STEPS;
    delete process.env.SEARCH_QUERY_CATEGORY_PROFILES_JSON;
    delete process.env.SEARCH_CJK_QUERY_ALIASES_JSON;
    delete process.env.SEARCH_INTENT_TOOL_BOOST_RULES_JSON;
    delete process.env.MCP_TRANSPORT;
    delete process.env.MCP_HOST;
    delete process.env.MCP_PORT;
    delete process.env.MCP_AUTH_TOKEN;
    delete process.env.MCP_ALLOW_INSECURE;
    delete process.env.MCP_RATE_LIMIT_MAX;
    delete process.env.MCP_LOG_LEVEL;
    delete process.env.SEARCH_VECTOR_ENABLED;
    delete process.env.SEARCH_VECTOR_MODEL_ID;
    delete process.env.SEARCH_VECTOR_COSINE_WEIGHT;
    delete process.env.SEARCH_VECTOR_DYNAMIC_WEIGHT;
    mockMissingEnvFile();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('logs warning when .env loading fails with an error other than ENOENT', async () => {
    const accessError = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    dotenvMock.config.mockReturnValue({ error: accessError });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getConfig } = await import('@utils/config');
    getConfig();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Warning: Failed to load .env'),
    );
    consoleError.mockRestore();
  });

  it('logs info when .env loads successfully in debug mode', async () => {
    // @ts-expect-error
    dotenvMock.config.mockReturnValue({ parsed: { MOCKED: 'true' } });
    process.env.DEBUG = 'true';

    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { getConfig } = await import('@utils/config');
    getConfig();

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('(debug mode)'));
    consoleInfo.mockRestore();
  });

  it('returns sane defaults when environment is empty', async () => {
    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    expect(config.mcp.name).toBe('jshookmcp');
    expect(config.mcp.version.length).toBeGreaterThan(0);
    expect(config.mcp.browserSessionQueueMaxPending).toBe(256);
    expect(config.mcp.browserSessionQueueMaxPendingPerSession).toBe(16);
    expect(config.mcp.browserSessionQueueWaitTimeoutMs).toBe(180_000);
    expect(config.mcp.browserSessionSchedulerQuantumMs).toBe(250);
    expect(config.mcp.browserSessionSchedulerAgingMs).toBe(15_000);
    expect(config.mcp.browserSessionExpectedConcurrency).toBe(10);
    expect(config.mcp.browserSessionReservedPendingPerSession).toBe(1);
    expect(config.mcp.browserSessionCostEwmaAlpha).toBe(0.2);
    expect(config.mcp.browserFleetWorkerId).toBe('local');
    expect(config.mcp.browserFleetWorkers).toEqual([{ id: 'local' }]);
    expect(config.mcp.browserFleetVirtualNodes).toBe(128);
    expect(config.mcp.browserFleetLeaseTtlMs).toBe(600_000);
    expect(config.mcp.browserFleetMaxLocalLeases).toBe(4096);
    expect(config.puppeteer.timeout).toBe(30000);
    expect(config.cache.ttl).toBe(3600);
    expect(config.performance.maxConcurrentAnalysis).toBe(3);
    expect(config.reverseEngineering.nativeEmulator.rawMemoryMaxBytes).toBe(16 * 1024 * 1024);
    expect(config.reverseEngineering.reverseSession.runMaxSteps).toBe(50);
    expect(config.search.queryCategoryProfiles.length).toBeGreaterThan(0);
    expect(config.search.cjkQueryAliases.length).toBeGreaterThan(0);
    expect(config.search.intentToolBoostRules.length).toBeGreaterThan(0);
    expect(config.search.vectorEnabled).toBe(true);
    expect(config.search.vectorModelId).toBe('minishlab/potion-code-16M-v2');
  });

  it('keeps the vector default independent of the transport', async () => {
    // The retrieval quality target does not depend on how the client connects,
    // so stdio and HTTP must agree — the old transport-derived default made
    // the same query behave differently per transport.
    process.env.MCP_TRANSPORT = 'http';
    const http = await import('@utils/config');
    const httpEnabled = http.getConfig().search.vectorEnabled;

    vi.resetModules();
    process.env.MCP_TRANSPORT = 'stdio';
    const stdio = await import('@utils/config');

    expect(httpEnabled).toBe(true);
    expect(stdio.getConfig().search.vectorEnabled).toBe(true);
  });

  it('honors explicit vector search overrides in runtime configuration', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.SEARCH_VECTOR_ENABLED = 'false';
    process.env.SEARCH_VECTOR_MODEL_ID = 'local/test-model';
    process.env.SEARCH_VECTOR_COSINE_WEIGHT = '0.25';
    process.env.SEARCH_VECTOR_DYNAMIC_WEIGHT = 'false';
    const { getConfig } = await import('@utils/config');
    const search = getConfig().search;

    expect(search).toMatchObject({
      vectorEnabled: false,
      vectorModelId: 'local/test-model',
      vectorCosineWeight: 0.25,
      vectorDynamicWeight: false,
    });
  });

  it('reads MCP server metadata from environment', async () => {
    process.env.MCP_SERVER_NAME = 'custom-server';
    process.env.MCP_SERVER_VERSION = '9.9.9';

    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    expect(config.mcp.name).toBe('custom-server');
    expect(config.mcp.version).toBe('9.9.9');
  });

  it('reads browser session scheduler limits from environment', async () => {
    process.env.MCP_BROWSER_SESSION_QUEUE_MAX_PENDING = '80';
    process.env.MCP_BROWSER_SESSION_QUEUE_MAX_PENDING_PER_SESSION = '8';
    process.env.MCP_BROWSER_SESSION_QUEUE_WAIT_TIMEOUT_MS = '12000';
    process.env.MCP_BROWSER_SESSION_SCHEDULER_QUANTUM_MS = '125';
    process.env.MCP_BROWSER_SESSION_SCHEDULER_AGING_MS = '4000';
    process.env.MCP_BROWSER_SESSION_EXPECTED_CONCURRENCY = '10';
    process.env.MCP_BROWSER_SESSION_RESERVED_PENDING_PER_SESSION = '2';
    process.env.MCP_BROWSER_SESSION_COST_EWMA_ALPHA = '0.35';

    const { getConfig } = await import('@utils/config');
    expect(getConfig().mcp).toMatchObject({
      browserSessionQueueMaxPending: 80,
      browserSessionQueueMaxPendingPerSession: 8,
      browserSessionQueueWaitTimeoutMs: 12_000,
      browserSessionSchedulerQuantumMs: 125,
      browserSessionSchedulerAgingMs: 4_000,
      browserSessionExpectedConcurrency: 10,
      browserSessionReservedPendingPerSession: 2,
      browserSessionCostEwmaAlpha: 0.35,
    });
  });

  it('reads a typed browser fleet topology from environment', async () => {
    process.env.MCP_BROWSER_FLEET_WORKER_ID = 'worker-a';
    process.env.MCP_BROWSER_FLEET_WORKERS_JSON = JSON.stringify([
      { id: 'worker-a', endpoint: 'http://worker-a', weight: 2 },
      { id: 'worker-b', endpoint: 'http://worker-b', accepting: false },
    ]);
    process.env.MCP_BROWSER_FLEET_VIRTUAL_NODES = '64';
    process.env.MCP_BROWSER_FLEET_LEASE_TTL_MS = '900000';
    process.env.MCP_BROWSER_FLEET_MAX_LOCAL_LEASES = '8192';

    const { getConfig } = await import('@utils/config');
    expect(getConfig().mcp).toMatchObject({
      browserFleetWorkerId: 'worker-a',
      browserFleetWorkers: [
        { id: 'worker-a', endpoint: 'http://worker-a', weight: 2 },
        { id: 'worker-b', endpoint: 'http://worker-b', accepting: false },
      ],
      browserFleetVirtualNodes: 64,
      browserFleetLeaseTtlMs: 900_000,
      browserFleetMaxLocalLeases: 8192,
    });
  });

  it('reads reverse-engineering runtime limits from environment', async () => {
    process.env.APK_STATIC_TRIAGE_DEFAULT_ENTRIES = '42';
    process.env.DEX_MAGIC_ASCII = 'dex\n';
    process.env.FRIDA_DEX_DUMP_TIMEOUT_MS = '1234';
    process.env.NEMU_RAW_MEMORY_MAX_BYTES = '8192';
    process.env.REVERSE_SESSION_RUN_MAX_STEPS = '7';
    process.env.TRANSFORM_WORKBENCH_MAX_STEPS = '5';

    const { getConfig } = await import('@utils/config');
    const config = getConfig().reverseEngineering;

    expect(config.apk.staticTriageDefaultEntries).toBe(42);
    expect(config.binaryMagic.dexMagicAscii).toBe('dex\n');
    expect(config.frida.dexDumpTimeoutMs).toBe(1234);
    expect(config.nativeEmulator.rawMemoryMaxBytes).toBe(8192);
    expect(config.reverseSession.runMaxSteps).toBe(7);
    expect(config.transformWorkbench.maxSteps).toBe(5);
  });

  it('falls back per field for malformed reverse-engineering env values', async () => {
    process.env.TRANSFORM_WORKBENCH_MAX_STEPS = 'abc';
    process.env.FRIDA_DEX_DUMP_TIMEOUT_MS = 'not-a-number';
    process.env.NEMU_GUEST_PAGE_SIZE_BYTES = '0';

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getConfig } = await import('@utils/config');
    const config = getConfig();

    // Invalid values fall back independently without discarding valid sibling
    // overrides or leaking unvalidated strings into the runtime config.
    expect(config.reverseEngineering.transformWorkbench.maxSteps).toBe(32);
    expect(config.reverseEngineering.frida.dexDumpTimeoutMs).toBe(180_000);
    expect(config.reverseEngineering.nativeEmulator.guestPageSizeBytes).toBe(4096);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid environment values'),
    );
    expect(config.puppeteer.timeout).toBe(30000);
    consoleError.mockRestore();
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

  it('normalizes supported boolean spellings consistently', async () => {
    process.env.PUPPETEER_HEADLESS = ' TRUE ';
    process.env.ENABLE_CACHE = '1';
    const { getConfig } = await import('@utils/config');

    expect(getConfig().puppeteer.headless).toBe(true);
    expect(getConfig().cache.enabled).toBe(true);
  });

  it('rejects partial numbers and keeps valid sibling overrides', async () => {
    process.env.PUPPETEER_TIMEOUT = '999999';
    process.env.MAX_CONCURRENT_ANALYSIS = '8';
    process.env.MAX_CODE_SIZE_MB = '20garbage';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getConfig, validateConfig } = await import('@utils/config');

    const config = getConfig();
    expect(config.puppeteer.timeout).toBe(30_000);
    expect(config.performance.maxConcurrentAnalysis).toBe(8);
    expect(config.performance.maxCodeSizeMB).toBe(10);
    expect(validateConfig(config)).toEqual({ valid: true, errors: [] });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('PUPPETEER_TIMEOUT'));
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('MAX_CODE_SIZE_MB'));
    consoleError.mockRestore();
  });

  it('loads critical server settings through the typed config', async () => {
    process.env.MCP_TRANSPORT = 'HTTP';
    process.env.MCP_HOST = '0.0.0.0';
    process.env.MCP_PORT = '4310';
    process.env.MCP_AUTH_TOKEN = 'test-token';
    process.env.MCP_RATE_LIMIT_MAX = '90';
    process.env.MCP_LOG_LEVEL = 'WARNING';
    const { getConfig } = await import('@utils/config');

    expect(getConfig().server).toMatchObject({
      transport: 'http',
      host: '0.0.0.0',
      port: 4310,
      authToken: 'test-token',
      logging: { level: 'warning' },
      http: { rateLimitMax: 90 },
    });
  });

  it('resolves relative cache directory against project root', async () => {
    process.env.CACHE_DIR = '.cache/custom';
    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    expect(config.cache.dir).toBe(join(getProjectRoot(), '.cache/custom'));
  });

  it.runIf(process.platform === 'win32')('preserves an absolute UNC cache path', async () => {
    process.env.CACHE_DIR = '\\\\server\\share\\jshook-cache';
    const { getConfig } = await import('@utils/config');

    expect(getConfig().cache.dir).toBe('\\\\server\\share\\jshook-cache');
  });

  it('resolves relative cache directory against the writable base in npx contexts', async () => {
    // In npx/global-install contexts the package root is an immutable install
    // cache; a relative CACHE_DIR must land in the user's cwd or the cache
    // silently degrades to a no-op (and pollutes the install dir).
    process.env.NPX_CACHE = '/tmp/npx-cache';
    process.env.CACHE_DIR = '.cache/npx-test';
    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    expect(config.cache.dir).toBe(join(process.cwd(), '.cache/npx-test'));
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

  it('skips invalid structures in search JSON properties', async () => {
    process.env.SEARCH_QUERY_CATEGORY_PROFILES_JSON = JSON.stringify([
      null,
      { pattern: 123 },
      { pattern: 'test', domainBoosts: 'not-array' },
      {
        pattern: 'test',
        domainBoosts: [null, { domain: 123 }, { domain: 'd', weight: 'not-number' }],
      },
    ]);
    process.env.SEARCH_CJK_QUERY_ALIASES_JSON = JSON.stringify([
      null,
      'string',
      { pattern: 123 }, // not string
      { pattern: 'test', tokens: 'not-array' },
    ]);
    process.env.SEARCH_INTENT_TOOL_BOOST_RULES_JSON = JSON.stringify([
      null,
      { pattern: 123 },
      { pattern: 'test', boosts: 'not-array' },
      { pattern: 'test', boosts: [null, { tool: 123 }, { tool: 't1', bonus: 'not-number' }] },
    ]);

    const { getConfig } = await import('@utils/config');
    const config = getConfig();

    expect(config.search.queryCategoryProfiles).toEqual([
      { pattern: 'test', flags: undefined, domainBoosts: [] },
    ]);
    expect(config.search.cjkQueryAliases).toEqual([]);
    expect(config.search.intentToolBoostRules).toEqual([
      { pattern: 'test', flags: undefined, boosts: [] },
    ]);
  });
});
