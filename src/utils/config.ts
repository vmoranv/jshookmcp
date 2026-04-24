import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { DEFAULT_SEARCH_CONFIG } from '@src/config/search-defaults';
import type {
  Config,
  SearchCjkQueryAliasConfig,
  SearchConfig,
  SearchIntentToolBoostRuleConfig,
  SearchQueryCategoryProfileConfig,
} from '@internal-types/index';

export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
let envLoaded = false;

const CONFIG_DEFAULTS = {
  puppeteer: {
    headless: false,
    timeout: 30000,
  },
  mcp: {
    name: 'jshookmcp',
    version: '0.1.8',
  },
  cache: {
    enabled: false,
    dir: '.cache',
    ttl: 3600,
  },
  paths: {
    screenshotDir: 'screenshots',
    captchaScreenshotDir: 'screenshots/captcha',
    debuggerSessionsDir: 'debugger-sessions',
    extensionRegistryDir: 'artifacts/extension-registry',
    tlsKeyLogDir: 'artifacts/tmp',
    registryCacheDir: '.jshookmcp/cache',
  },
  performance: {
    maxConcurrentAnalysis: 3,
    maxCodeSizeMB: 10,
  },
} as const;

function loadEnvIfNeeded(): void {
  if (envLoaded) {
    return;
  }
  envLoaded = true;

  const result = dotenvConfig({ path: envPath, quiet: true });
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;

  if (result.error && errorCode !== 'ENOENT') {
    console.error('[Config] Warning: Failed to load .env file from configured path');
    console.error(`[Config] Error: ${result.error.message}`);
    console.error('[Config] Will use environment variables or defaults');
  } else if (!result.error && process.env.DEBUG === 'true') {
    console.info('[Config] .env file loaded (debug mode)');
  }
}

// ── Zod schemas for environment-based config ──

const envInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : fallback))
    .pipe(z.number().int().finite());

const envBool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true'));

function resolveConfigPath(inputPath: string, baseDir: string): string {
  return normalize(isAbsolute(inputPath) ? inputPath : resolve(baseDir, inputPath));
}

// Custom validation schemas
const httpUrl = z
  .string()
  .url()
  .refine((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be a valid HTTP or HTTPS URL');

const port = z.coerce.number().int().min(1).max(65535);

const safePath = z.string().refine((path) => {
  // No absolute paths on Unix-like systems, no traversal, no backslashes
  return !path.startsWith('/') && !path.includes('..') && !path.includes('\\');
}, 'Path must be relative and safe (no absolute paths, no directory traversal, no backslashes)');

const apiKey = z
  .string()
  .min(10)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'API key must be at least 10 characters and contain only alphanumeric characters, dashes, or underscores',
  );

const ConfigSchema = z.object({
  // Puppeteer
  PUPPETEER_HEADLESS: envBool(CONFIG_DEFAULTS.puppeteer.headless),
  PUPPETEER_TIMEOUT: envInt(CONFIG_DEFAULTS.puppeteer.timeout).pipe(
    z.number().min(1000).max(300000),
  ),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  CHROME_PATH: z.string().optional(),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),

  // MCP
  MCP_SERVER_NAME: z.string().optional().default(CONFIG_DEFAULTS.mcp.name),
  MCP_SERVER_VERSION: z.string().optional().default(CONFIG_DEFAULTS.mcp.version),

  // Cache
  ENABLE_CACHE: envBool(CONFIG_DEFAULTS.cache.enabled),
  CACHE_DIR: z.string().optional().default(CONFIG_DEFAULTS.cache.dir),
  CACHE_TTL: envInt(CONFIG_DEFAULTS.cache.ttl).pipe(z.number().min(0)),

  // Paths
  MCP_SCREENSHOT_DIR: safePath.optional().default(CONFIG_DEFAULTS.paths.screenshotDir),
  CAPTCHA_SCREENSHOT_DIR: safePath.optional().default(CONFIG_DEFAULTS.paths.captchaScreenshotDir),
  MCP_DEBUGGER_SESSIONS_DIR: safePath.optional().default(CONFIG_DEFAULTS.paths.debuggerSessionsDir),
  MCP_EXTENSION_REGISTRY_DIR: safePath
    .optional()
    .default(CONFIG_DEFAULTS.paths.extensionRegistryDir),
  MCP_TLS_KEYLOG_DIR: safePath.optional().default(CONFIG_DEFAULTS.paths.tlsKeyLogDir),
  MCP_REGISTRY_CACHE_DIR: safePath.optional().default(CONFIG_DEFAULTS.paths.registryCacheDir),

  // Performance
  MAX_CONCURRENT_ANALYSIS: envInt(CONFIG_DEFAULTS.performance.maxConcurrentAnalysis).pipe(
    z.number().min(1).max(32),
  ),
  MAX_CODE_SIZE_MB: envInt(CONFIG_DEFAULTS.performance.maxCodeSizeMB).pipe(
    z.number().min(1).max(500),
  ),

  // Additional validated environment variables
  // URLs
  CAPTCHA_SOLVER_BASE_URL: httpUrl.optional(),
  EXTENSION_REGISTRY_BASE_URL: httpUrl.optional(),
  BURP_MCP_SSE_URL: httpUrl.optional(),

  // Ports
  MCP_PORT: port.optional(),
  DEFAULT_DEBUG_PORT: port.optional(),

  // API Keys/Tokens
  CAPTCHA_API_KEY: apiKey.optional(),
  MCP_AUTH_TOKEN: apiKey.optional(),
  MCP_PLUGIN_SIGNATURE_SECRET: apiKey.optional(),

  // Numeric values with ranges
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional().default('info'),
  RUNTIME_ERROR_WINDOW_MS: z.coerce.number().int().min(1000).max(300000).optional().default(60000),
  RUNTIME_ERROR_THRESHOLD: z.coerce.number().int().min(1).max(100).optional().default(5),
  MCP_MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .optional()
    .default(10 * 1024 * 1024),
  MCP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(300000).optional().default(60000),
  MCP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).optional().default(60),
  MCP_HTTP_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .optional()
    .default(30000),
  MCP_HTTP_HEADERS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .optional()
    .default(10000),
  MCP_HTTP_KEEPALIVE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .optional()
    .default(60000),
  MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .optional()
    .default(5000),
  CACHE_GLOBAL_MAX_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024 * 1024)
    .optional()
    .default(524288000),
  TOKEN_BUDGET_MAX_TOKENS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(1000000)
    .optional()
    .default(200000),
  DETAILED_DATA_DEFAULT_TTL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .optional()
    .default(1800000),
  DETAILED_DATA_MAX_TTL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(86400000)
    .optional()
    .default(3600000),
  DETAILED_DATA_SMART_THRESHOLD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(104857600)
    .optional()
    .default(51200),
  jshook_IO_CONCURRENCY: z.coerce.number().int().min(1).max(32).optional().default(4),
  jshook_CPU_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional().default(2),
  jshook_CDP_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional().default(2),
  WORKER_POOL_MIN_WORKERS: z.coerce.number().int().min(1).max(16).optional().default(2),
  WORKER_POOL_MAX_WORKERS: z.coerce.number().int().min(1).max(32).optional().default(4),
  WORKER_POOL_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .optional()
    .default(30000),
  WORKER_POOL_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .optional()
    .default(15000),
  PARALLEL_DEFAULT_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional().default(3),
  PARALLEL_DEFAULT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .optional()
    .default(60000),
  PARALLEL_DEFAULT_MAX_RETRIES: z.coerce.number().int().min(0).max(10).optional().default(2),
  PARALLEL_RETRY_BACKOFF_BASE_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10000)
    .optional()
    .default(1000),
  EXTERNAL_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).optional().default(30000),
  EXTERNAL_TOOL_PROBE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .optional()
    .default(5000),
  EXTERNAL_TOOL_PROBE_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .optional()
    .default(60000),
  EXTERNAL_TOOL_FORCE_KILL_GRACE_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10000)
    .optional()
    .default(2000),
  EXTERNAL_TOOL_MAX_STDOUT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .optional()
    .default(10485760),
  EXTERNAL_TOOL_MAX_STDERR_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .optional()
    .default(1048576),
  SANDBOX_EXEC_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).optional().default(5000),
  SANDBOX_MEMORY_LIMIT_MB: z.coerce.number().int().min(16).max(2048).optional().default(128),
  SANDBOX_STACK_SIZE_MB: z.coerce.number().int().min(1).max(64).optional().default(4),
  SANDBOX_TERMINATE_GRACE_MS: z.coerce.number().int().min(100).max(10000).optional().default(2000),
  SYMBOLIC_EXEC_MAX_PATHS: z.coerce.number().int().min(1).max(1000).optional().default(100),
  SYMBOLIC_EXEC_MAX_DEPTH: z.coerce.number().int().min(1).max(200).optional().default(50),
  SYMBOLIC_EXEC_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).optional().default(30000),
  PACKER_SANDBOX_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).optional().default(3000),
  ADV_DEOBF_LLM_MAX_TOKENS: z.coerce.number().int().min(100).max(10000).optional().default(3000),
  VM_DEOBF_LLM_MAX_TOKENS: z.coerce.number().int().min(100).max(10000).optional().default(4000),
  DEOBF_LLM_MAX_TOKENS: z.coerce.number().int().min(100).max(10000).optional().default(2000),
  CRYPTO_DETECT_LLM_MAX_TOKENS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10000)
    .optional()
    .default(2000),
  WORKFLOW_BATCH_MAX_RETRIES: z.coerce.number().int().min(0).max(10).optional().default(3),
  WORKFLOW_BATCH_MAX_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(600000)
    .optional()
    .default(300000),
  WORKFLOW_BUNDLE_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(86400000)
    .optional()
    .default(300000),
  WORKFLOW_BUNDLE_CACHE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024 * 1024)
    .optional()
    .default(104857600),
  MEMORY_READ_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).optional().default(10000),
  MEMORY_MAX_READ_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .optional()
    .default(16777216),
  MEMORY_WRITE_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).optional().default(10000),
  MEMORY_MAX_WRITE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .optional()
    .default(16384),
  MEMORY_DUMP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).optional().default(60000),
  MEMORY_SCAN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).optional().default(120000),
  MEMORY_SCAN_MAX_BUFFER_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .optional()
    .default(52428800),
  MEMORY_SCAN_MAX_RESULTS: z.coerce.number().int().min(1).max(100000).optional().default(10000),
  MEMORY_SCAN_MAX_REGIONS: z.coerce.number().int().min(1).max(100000).optional().default(50000),
  MEMORY_SCAN_REGION_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .optional()
    .default(16777216),
  MEMORY_INJECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(300000).optional().default(30000),
  MEMORY_MONITOR_INTERVAL_MS: z.coerce.number().int().min(100).max(10000).optional().default(1000),
  MEMORY_VMMAP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).optional().default(15000),
  MEMORY_PROTECTION_QUERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .optional()
    .default(15000),
  MEMORY_PROTECTION_PWSH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300000)
    .optional()
    .default(30000),
  NATIVE_ADMIN_CHECK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .optional()
    .default(5000),
  NATIVE_SCAN_MAX_RESULTS: z.coerce.number().int().min(1).max(100000).optional().default(10000),
  PROCESS_LAUNCH_WAIT_MS: z.coerce.number().int().min(100).max(10000).optional().default(2000),
  WIN_DEBUG_PORT_POLL_ATTEMPTS: z.coerce.number().int().min(1).max(100).optional().default(20),
  WIN_DEBUG_PORT_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(5000)
    .optional()
    .default(500),
  CAPTCHA_DEFAULT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .optional()
    .default(180000),

  // Enums and booleans
  MCP_TRANSPORT: z.enum(['stdio', 'http']).optional().default('stdio'),
  MCP_HOST: z.string().optional().default('127.0.0.1'),
  MCP_ALLOW_INSECURE: z.coerce.boolean().optional().default(false),
  MCP_TOOL_PROFILE: z.enum(['search', 'workflow', 'full']).optional().default('search'),
  MCP_DEFAULT_PLUGIN_BOOST_TIER: z.enum(['search', 'workflow', 'full']).optional().default('full'),
  MCP_PLUGIN_SIGNATURE_REQUIRED: z.coerce.boolean().optional(),
  MCP_PLUGIN_STRICT_LOAD: z.coerce.boolean().optional(),
  CAPTCHA_PROVIDER: z
    .enum(['manual', '2captcha', 'anticaptcha', 'capmonster'])
    .optional()
    .default('manual'),

  // String arrays (comma-separated)
  MCP_TOOL_DOMAINS: z.string().optional(),
  MCP_PLUGIN_ROOTS: z.string().optional(),
  MCP_WORKFLOW_ROOTS: z.string().optional(),
  MCP_PLUGIN_ALLOWED_DIGESTS: z.string().optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonArrayEnv(key: string): unknown[] | undefined {
  const raw = process.env[key];
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseSearchQueryCategoryProfiles(): SearchQueryCategoryProfileConfig[] | undefined {
  const parsed = parseJsonArrayEnv('SEARCH_QUERY_CATEGORY_PROFILES_JSON');
  if (parsed === undefined) {
    return undefined;
  }

  return parsed.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.pattern !== 'string' ||
      !Array.isArray(entry.domainBoosts)
    ) {
      return [];
    }

    const domainBoosts = entry.domainBoosts.flatMap((boost) => {
      if (
        !isRecord(boost) ||
        typeof boost.domain !== 'string' ||
        typeof boost.weight !== 'number'
      ) {
        return [];
      }
      return [{ domain: boost.domain, weight: boost.weight }];
    });

    return [
      {
        pattern: entry.pattern,
        flags: typeof entry.flags === 'string' ? entry.flags : undefined,
        domainBoosts,
      },
    ];
  });
}

function parseCjkQueryAliases(): SearchCjkQueryAliasConfig[] | undefined {
  const parsed = parseJsonArrayEnv('SEARCH_CJK_QUERY_ALIASES_JSON');
  if (parsed === undefined) {
    return undefined;
  }

  return parsed.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.pattern !== 'string' || !Array.isArray(entry.tokens)) {
      return [];
    }

    const tokens = entry.tokens.filter((token): token is string => typeof token === 'string');
    return [
      {
        pattern: entry.pattern,
        flags: typeof entry.flags === 'string' ? entry.flags : undefined,
        tokens,
      },
    ];
  });
}

function parseIntentToolBoostRules(): SearchIntentToolBoostRuleConfig[] | undefined {
  const parsed = parseJsonArrayEnv('SEARCH_INTENT_TOOL_BOOST_RULES_JSON');
  if (parsed === undefined) {
    return undefined;
  }

  return parsed.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.pattern !== 'string' || !Array.isArray(entry.boosts)) {
      return [];
    }

    const boosts = entry.boosts.flatMap((boost) => {
      if (!isRecord(boost) || typeof boost.tool !== 'string' || typeof boost.bonus !== 'number') {
        return [];
      }
      return [{ tool: boost.tool, bonus: boost.bonus }];
    });

    return [
      {
        pattern: entry.pattern,
        flags: typeof entry.flags === 'string' ? entry.flags : undefined,
        boosts,
      },
    ];
  });
}

function cloneSearchConfig(search: SearchConfig): SearchConfig {
  return {
    queryCategoryProfiles: search.queryCategoryProfiles.map((profile) => ({
      pattern: profile.pattern,
      flags: profile.flags,
      domainBoosts: profile.domainBoosts.map((boost) => ({
        domain: boost.domain,
        weight: boost.weight,
      })),
    })),
    cjkQueryAliases: search.cjkQueryAliases.map((alias) => ({
      pattern: alias.pattern,
      flags: alias.flags,
      tokens: [...alias.tokens],
    })),
    intentToolBoostRules: search.intentToolBoostRules.map((rule) => ({
      pattern: rule.pattern,
      flags: rule.flags,
      boosts: rule.boosts.map((boost) => ({
        tool: boost.tool,
        bonus: boost.bonus,
      })),
    })),
  };
}

function buildSearchConfig(): SearchConfig {
  const defaults = cloneSearchConfig(DEFAULT_SEARCH_CONFIG);

  return {
    queryCategoryProfiles: parseSearchQueryCategoryProfiles() ?? defaults.queryCategoryProfiles,
    cjkQueryAliases: parseCjkQueryAliases() ?? defaults.cjkQueryAliases,
    intentToolBoostRules: parseIntentToolBoostRules() ?? defaults.intentToolBoostRules,
  };
}

function coerceBooleanEnv(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true';
  }
  return fallback;
}

function coerceIntegerEnv(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function getConfig(): Config {
  loadEnvIfNeeded();

  const parsed = ConfigSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    console.error(`[Config] Validation errors:\n${issues.join('\n')}`);
    console.error('[Config] Invalid environment variables detected. Failing startup.');
    process.exit(1);
  }

  const env = parsed.data;

  const cacheDir = (env.CACHE_DIR as string) || CONFIG_DEFAULTS.cache.dir;
  const configuredExecutablePath =
    (env.PUPPETEER_EXECUTABLE_PATH as string) ||
    (env.CHROME_PATH as string) ||
    (env.BROWSER_EXECUTABLE_PATH as string);
  const absoluteCacheDir =
    cacheDir.startsWith('/') || cacheDir.match(/^[A-Za-z]:/)
      ? cacheDir
      : join(projectRoot, cacheDir);
  const search = buildSearchConfig();
  const paths = {
    screenshotDir: resolveConfigPath(
      (env.MCP_SCREENSHOT_DIR as string) || CONFIG_DEFAULTS.paths.screenshotDir,
      projectRoot,
    ),
    captchaScreenshotDir: resolveConfigPath(
      (env.CAPTCHA_SCREENSHOT_DIR as string) || CONFIG_DEFAULTS.paths.captchaScreenshotDir,
      projectRoot,
    ),
    debuggerSessionsDir: resolveConfigPath(
      (env.MCP_DEBUGGER_SESSIONS_DIR as string) || CONFIG_DEFAULTS.paths.debuggerSessionsDir,
      process.cwd(),
    ),
    extensionRegistryDir: resolveConfigPath(
      (env.MCP_EXTENSION_REGISTRY_DIR as string) || CONFIG_DEFAULTS.paths.extensionRegistryDir,
      projectRoot,
    ),
    tlsKeyLogDir: resolveConfigPath(
      (env.MCP_TLS_KEYLOG_DIR as string) || CONFIG_DEFAULTS.paths.tlsKeyLogDir,
      projectRoot,
    ),
    registryCacheDir: resolveConfigPath(
      (env.MCP_REGISTRY_CACHE_DIR as string) || CONFIG_DEFAULTS.paths.registryCacheDir,
      homedir(),
    ),
  };

  return {
    puppeteer: {
      headless: coerceBooleanEnv(env.PUPPETEER_HEADLESS, CONFIG_DEFAULTS.puppeteer.headless),
      timeout: coerceIntegerEnv(env.PUPPETEER_TIMEOUT, CONFIG_DEFAULTS.puppeteer.timeout),
      executablePath: configuredExecutablePath?.trim() || undefined,
    },
    mcp: {
      name: (env.MCP_SERVER_NAME as string) || CONFIG_DEFAULTS.mcp.name,
      version: (env.MCP_SERVER_VERSION as string) || CONFIG_DEFAULTS.mcp.version,
    },
    cache: {
      enabled: coerceBooleanEnv(env.ENABLE_CACHE, CONFIG_DEFAULTS.cache.enabled),
      dir: absoluteCacheDir,
      ttl: coerceIntegerEnv(env.CACHE_TTL, CONFIG_DEFAULTS.cache.ttl),
    },
    paths,
    performance: {
      maxConcurrentAnalysis: coerceIntegerEnv(
        env.MAX_CONCURRENT_ANALYSIS,
        CONFIG_DEFAULTS.performance.maxConcurrentAnalysis,
      ),
      maxCodeSizeMB: coerceIntegerEnv(
        env.MAX_CODE_SIZE_MB,
        CONFIG_DEFAULTS.performance.maxCodeSizeMB,
      ),
    },
    search,
    validation: {
      // URLs
      captchaSolverBaseUrl: env.CAPTCHA_SOLVER_BASE_URL,
      extensionRegistryBaseUrl: env.EXTENSION_REGISTRY_BASE_URL,
      burpMcpSseUrl: env.BURP_MCP_SSE_URL,

      // Ports
      mcpPort: env.MCP_PORT,
      defaultDebugPort: env.DEFAULT_DEBUG_PORT,

      // API Keys/Tokens
      captchaApiKey: env.CAPTCHA_API_KEY,
      mcpAuthToken: env.MCP_AUTH_TOKEN,
      mcpPluginSignatureSecret: env.MCP_PLUGIN_SIGNATURE_SECRET,

      // Logging and runtime
      logLevel: env.LOG_LEVEL,
      runtimeErrorWindowMs: env.RUNTIME_ERROR_WINDOW_MS,
      runtimeErrorThreshold: env.RUNTIME_ERROR_THRESHOLD,

      // HTTP and transport
      mcpTransport: env.MCP_TRANSPORT,
      mcpHost: env.MCP_HOST,
      mcpAllowInsecure: env.MCP_ALLOW_INSECURE,
      mcpMaxBodyBytes: env.MCP_MAX_BODY_BYTES,
      mcpRateLimitWindowMs: env.MCP_RATE_LIMIT_WINDOW_MS,
      mcpRateLimitMax: env.MCP_RATE_LIMIT_MAX,
      mcpHttpRequestTimeoutMs: env.MCP_HTTP_REQUEST_TIMEOUT_MS,
      mcpHttpHeadersTimeoutMs: env.MCP_HTTP_HEADERS_TIMEOUT_MS,
      mcpHttpKeepaliveTimeoutMs: env.MCP_HTTP_KEEPALIVE_TIMEOUT_MS,
      mcpHttpForceCloseTimeoutMs: env.MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS,

      // Tool and plugin configuration
      mcpToolProfile: env.MCP_TOOL_PROFILE,
      mcpToolDomains: env.MCP_TOOL_DOMAINS,
      mcpDefaultPluginBoostTier: env.MCP_DEFAULT_PLUGIN_BOOST_TIER,
      mcpPluginRoots: env.MCP_PLUGIN_ROOTS,
      mcpWorkflowRoots: env.MCP_WORKFLOW_ROOTS,
      mcpPluginAllowedDigests: env.MCP_PLUGIN_ALLOWED_DIGESTS,
      mcpPluginSignatureRequired: env.MCP_PLUGIN_SIGNATURE_REQUIRED,
      mcpPluginStrictLoad: env.MCP_PLUGIN_STRICT_LOAD,

      // Cache and performance
      cacheGlobalMaxSizeBytes: env.CACHE_GLOBAL_MAX_SIZE_BYTES,
      tokenBudgetMaxTokens: env.TOKEN_BUDGET_MAX_TOKENS,
      detailedDataDefaultTtlMs: env.DETAILED_DATA_DEFAULT_TTL_MS,
      detailedDataMaxTtlMs: env.DETAILED_DATA_MAX_TTL_MS,
      detailedDataSmartThresholdBytes: env.DETAILED_DATA_SMART_THRESHOLD_BYTES,
      jshookIoConcurrency: env.jshook_IO_CONCURRENCY,
      jshookCpuConcurrency: env.jshook_CPU_CONCURRENCY,
      jshookCdpConcurrency: env.jshook_CDP_CONCURRENCY,

      // Worker pools
      workerPoolMinWorkers: env.WORKER_POOL_MIN_WORKERS,
      workerPoolMaxWorkers: env.WORKER_POOL_MAX_WORKERS,
      workerPoolIdleTimeoutMs: env.WORKER_POOL_IDLE_TIMEOUT_MS,
      workerPoolJobTimeoutMs: env.WORKER_POOL_JOB_TIMEOUT_MS,

      // Parallel execution
      parallelDefaultConcurrency: env.PARALLEL_DEFAULT_CONCURRENCY,
      parallelDefaultTimeoutMs: env.PARALLEL_DEFAULT_TIMEOUT_MS,
      parallelDefaultMaxRetries: env.PARALLEL_DEFAULT_MAX_RETRIES,
      parallelRetryBackoffBaseMs: env.PARALLEL_RETRY_BACKOFF_BASE_MS,

      // External tools and sandbox
      externalToolTimeoutMs: env.EXTERNAL_TOOL_TIMEOUT_MS,
      externalToolProbeTimeoutMs: env.EXTERNAL_TOOL_PROBE_TIMEOUT_MS,
      externalToolProbeCacheTtlMs: env.EXTERNAL_TOOL_PROBE_CACHE_TTL_MS,
      externalToolForceKillGraceMs: env.EXTERNAL_TOOL_FORCE_KILL_GRACE_MS,
      externalToolMaxStdoutBytes: env.EXTERNAL_TOOL_MAX_STDOUT_BYTES,
      externalToolMaxStderrBytes: env.EXTERNAL_TOOL_MAX_STDERR_BYTES,
      sandboxExecTimeoutMs: env.SANDBOX_EXEC_TIMEOUT_MS,
      sandboxMemoryLimitMb: env.SANDBOX_MEMORY_LIMIT_MB,
      sandboxStackSizeMb: env.SANDBOX_STACK_SIZE_MB,
      sandboxTerminateGraceMs: env.SANDBOX_TERMINATE_GRACE_MS,

      // Symbolic execution
      symbolicExecMaxPaths: env.SYMBOLIC_EXEC_MAX_PATHS,
      symbolicExecMaxDepth: env.SYMBOLIC_EXEC_MAX_DEPTH,
      symbolicExecTimeoutMs: env.SYMBOLIC_EXEC_TIMEOUT_MS,
      packerSandboxTimeoutMs: env.PACKER_SANDBOX_TIMEOUT_MS,

      // LLM token limits
      advDeobfLlmMaxTokens: env.ADV_DEOBF_LLM_MAX_TOKENS,
      vmDeobfLlmMaxTokens: env.VM_DEOBF_LLM_MAX_TOKENS,
      deobfLlmMaxTokens: env.DEOBF_LLM_MAX_TOKENS,
      cryptoDetectLlmMaxTokens: env.CRYPTO_DETECT_LLM_MAX_TOKENS,

      // Workflow batch processing
      workflowBatchMaxRetries: env.WORKFLOW_BATCH_MAX_RETRIES,
      workflowBatchMaxTimeoutMs: env.WORKFLOW_BATCH_MAX_TIMEOUT_MS,
      workflowBundleCacheTtlMs: env.WORKFLOW_BUNDLE_CACHE_TTL_MS,
      workflowBundleCacheMaxBytes: env.WORKFLOW_BUNDLE_CACHE_MAX_BYTES,

      // Memory operations
      memoryReadTimeoutMs: env.MEMORY_READ_TIMEOUT_MS,
      memoryMaxReadBytes: env.MEMORY_MAX_READ_BYTES,
      memoryWriteTimeoutMs: env.MEMORY_WRITE_TIMEOUT_MS,
      memoryMaxWriteBytes: env.MEMORY_MAX_WRITE_BYTES,
      memoryDumpTimeoutMs: env.MEMORY_DUMP_TIMEOUT_MS,
      memoryScanTimeoutMs: env.MEMORY_SCAN_TIMEOUT_MS,
      memoryScanMaxBufferBytes: env.MEMORY_SCAN_MAX_BUFFER_BYTES,
      memoryScanMaxResults: env.MEMORY_SCAN_MAX_RESULTS,
      memoryScanMaxRegions: env.MEMORY_SCAN_MAX_REGIONS,
      memoryScanRegionMaxBytes: env.MEMORY_SCAN_REGION_MAX_BYTES,
      memoryInjectTimeoutMs: env.MEMORY_INJECT_TIMEOUT_MS,
      memoryMonitorIntervalMs: env.MEMORY_MONITOR_INTERVAL_MS,
      memoryVmMapTimeoutMs: env.MEMORY_VMMAP_TIMEOUT_MS,
      memoryProtectionQueryTimeoutMs: env.MEMORY_PROTECTION_QUERY_TIMEOUT_MS,
      memoryProtectionPwshTimeoutMs: env.MEMORY_PROTECTION_PWSH_TIMEOUT_MS,

      // Native operations
      nativeAdminCheckTimeoutMs: env.NATIVE_ADMIN_CHECK_TIMEOUT_MS,
      nativeScanMaxResults: env.NATIVE_SCAN_MAX_RESULTS,
      processLaunchWaitMs: env.PROCESS_LAUNCH_WAIT_MS,
      winDebugPortPollAttempts: env.WIN_DEBUG_PORT_POLL_ATTEMPTS,
      winDebugPortPollIntervalMs: env.WIN_DEBUG_PORT_POLL_INTERVAL_MS,

      // CAPTCHA
      captchaProvider: env.CAPTCHA_PROVIDER,
      captchaDefaultTimeoutMs: env.CAPTCHA_DEFAULT_TIMEOUT_MS,
    },
  };
}

export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.performance.maxConcurrentAnalysis < 1) {
    errors.push('maxConcurrentAnalysis must be at least 1');
  }

  if (config.performance.maxCodeSizeMB < 1) {
    errors.push('maxCodeSizeMB must be at least 1');
  }

  if (config.puppeteer.timeout < 1000) {
    errors.push('puppeteer.timeout must be at least 1000ms');
  }

  if (config.cache.ttl < 0) {
    errors.push('cache.ttl must be non-negative');
  }

  // Validation for new validation config
  const v = config.validation;

  if (v.mcpPort !== undefined && (v.mcpPort < 1 || v.mcpPort > 65535)) {
    errors.push('mcpPort must be between 1 and 65535');
  }

  if (v.defaultDebugPort !== undefined && (v.defaultDebugPort < 1 || v.defaultDebugPort > 65535)) {
    errors.push('defaultDebugPort must be between 1 and 65535');
  }

  if (v.runtimeErrorWindowMs < 1000) {
    errors.push('runtimeErrorWindowMs must be at least 1000ms');
  }

  if (v.runtimeErrorThreshold < 1) {
    errors.push('runtimeErrorThreshold must be at least 1');
  }

  if (v.mcpMaxBodyBytes < 1024) {
    errors.push('mcpMaxBodyBytes must be at least 1024 bytes');
  }

  if (v.cacheGlobalMaxSizeBytes < 1024) {
    errors.push('cacheGlobalMaxSizeBytes must be at least 1024 bytes');
  }

  if (v.tokenBudgetMaxTokens < 1000) {
    errors.push('tokenBudgetMaxTokens must be at least 1000');
  }

  if (v.workerPoolMinWorkers > v.workerPoolMaxWorkers) {
    errors.push('workerPoolMinWorkers cannot be greater than workerPoolMaxWorkers');
  }

  for (const profile of config.search.queryCategoryProfiles) {
    try {
      void new RegExp(profile.pattern, profile.flags);
    } catch {
      errors.push(`search.queryCategoryProfiles contains invalid regex: ${profile.pattern}`);
    }
  }

  for (const alias of config.search.cjkQueryAliases) {
    try {
      void new RegExp(alias.pattern, alias.flags);
    } catch {
      errors.push(`search.cjkQueryAliases contains invalid regex: ${alias.pattern}`);
    }
  }

  for (const rule of config.search.intentToolBoostRules) {
    try {
      void new RegExp(rule.pattern, rule.flags);
    } catch {
      errors.push(`search.intentToolBoostRules contains invalid regex: ${rule.pattern}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
