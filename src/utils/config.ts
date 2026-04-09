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
  MCP_SCREENSHOT_DIR: z.string().optional().default(CONFIG_DEFAULTS.paths.screenshotDir),
  CAPTCHA_SCREENSHOT_DIR: z.string().optional().default(CONFIG_DEFAULTS.paths.captchaScreenshotDir),
  MCP_DEBUGGER_SESSIONS_DIR: z
    .string()
    .optional()
    .default(CONFIG_DEFAULTS.paths.debuggerSessionsDir),
  MCP_EXTENSION_REGISTRY_DIR: z
    .string()
    .optional()
    .default(CONFIG_DEFAULTS.paths.extensionRegistryDir),
  MCP_TLS_KEYLOG_DIR: z.string().optional().default(CONFIG_DEFAULTS.paths.tlsKeyLogDir),
  MCP_REGISTRY_CACHE_DIR: z.string().optional().default(CONFIG_DEFAULTS.paths.registryCacheDir),

  // Performance
  MAX_CONCURRENT_ANALYSIS: envInt(CONFIG_DEFAULTS.performance.maxConcurrentAnalysis).pipe(
    z.number().min(1).max(32),
  ),
  MAX_CODE_SIZE_MB: envInt(CONFIG_DEFAULTS.performance.maxCodeSizeMB).pipe(
    z.number().min(1).max(500),
  ),
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
    console.error('[Config] Falling back to safe defaults for invalid fields');
  }

  // Use parsed data if valid, otherwise fall back to process.env with defaults
  const env = parsed.success ? parsed.data : process.env;

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
