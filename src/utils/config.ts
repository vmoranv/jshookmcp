import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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

const ConfigSchema = z.object({
  // LLM
  DEFAULT_LLM_PROVIDER: z.enum(['openai', 'anthropic']).optional().default('openai'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().optional().default('gpt-4-turbo-preview'),
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().optional().default('claude-3-5-sonnet-20241022'),
  ANTHROPIC_BASE_URL: z.string().optional(),

  // Puppeteer
  PUPPETEER_HEADLESS: envBool(false),
  PUPPETEER_TIMEOUT: envInt(30000).pipe(z.number().min(1000).max(300000)),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  CHROME_PATH: z.string().optional(),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),

  // MCP
  MCP_SERVER_NAME: z.string().optional().default('jshookmcp'),
  MCP_SERVER_VERSION: z.string().optional().default('0.1.8'),

  // Cache
  ENABLE_CACHE: envBool(false),
  CACHE_DIR: z.string().optional().default('.cache'),
  CACHE_TTL: envInt(3600).pipe(z.number().min(0)),

  // Performance
  MAX_CONCURRENT_ANALYSIS: envInt(3).pipe(z.number().min(1).max(32)),
  MAX_CODE_SIZE_MB: envInt(10).pipe(z.number().min(1).max(500)),
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

  const cacheDir = (env.CACHE_DIR as string) || '.cache';
  const configuredExecutablePath =
    (env.PUPPETEER_EXECUTABLE_PATH as string) ||
    (env.CHROME_PATH as string) ||
    (env.BROWSER_EXECUTABLE_PATH as string);
  const absoluteCacheDir =
    cacheDir.startsWith('/') || cacheDir.match(/^[A-Za-z]:/)
      ? cacheDir
      : join(projectRoot, cacheDir);
  const search = buildSearchConfig();

  return {
    llm: {
      provider: ((env.DEFAULT_LLM_PROVIDER as string) || 'openai') as 'openai' | 'anthropic',
      openai: {
        apiKey: (env.OPENAI_API_KEY as string) || '',
        model: (env.OPENAI_MODEL as string) || 'gpt-4-turbo-preview',
        baseURL: env.OPENAI_BASE_URL as string | undefined,
      },
      anthropic: {
        apiKey: (env.ANTHROPIC_API_KEY as string) || '',
        model: (env.ANTHROPIC_MODEL as string) || 'claude-3-5-sonnet-20241022',
        baseURL: env.ANTHROPIC_BASE_URL as string | undefined,
      },
    },
    puppeteer: {
      headless: parsed.success
        ? (env.PUPPETEER_HEADLESS as unknown as boolean)
        : process.env.PUPPETEER_HEADLESS === 'true',
      timeout: parsed.success
        ? (env.PUPPETEER_TIMEOUT as unknown as number)
        : parseInt(process.env.PUPPETEER_TIMEOUT || '30000', 10),
      executablePath: configuredExecutablePath?.trim() || undefined,
    },
    mcp: {
      name: (env.MCP_SERVER_NAME as string) || 'jshookmcp',
      version: (env.MCP_SERVER_VERSION as string) || '0.1.8',
    },
    cache: {
      enabled: parsed.success
        ? (env.ENABLE_CACHE as unknown as boolean)
        : process.env.ENABLE_CACHE === 'true',
      dir: absoluteCacheDir,
      ttl: parsed.success
        ? (env.CACHE_TTL as unknown as number)
        : parseInt(process.env.CACHE_TTL || '3600', 10),
    },
    performance: {
      maxConcurrentAnalysis: parsed.success
        ? (env.MAX_CONCURRENT_ANALYSIS as unknown as number)
        : parseInt(process.env.MAX_CONCURRENT_ANALYSIS || '3', 10),
      maxCodeSizeMB: parsed.success
        ? (env.MAX_CODE_SIZE_MB as unknown as number)
        : parseInt(process.env.MAX_CODE_SIZE_MB || '10', 10),
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
