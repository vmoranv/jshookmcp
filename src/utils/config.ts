import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import type { Config } from '../types/index.js';

const currentFilename = fileURLToPath(import.meta.url);
const currentDirname = dirname(currentFilename);
const projectRoot = join(currentDirname, '..', '..');

const envPath = join(projectRoot, '.env');
const result = dotenvConfig({ path: envPath, quiet: true });

if (result.error) {
  console.error(`[Config] Warning: Failed to load .env file from ${envPath}`);
  console.error(`[Config] Error: ${result.error.message}`);
  console.error('[Config] Will use environment variables or defaults');
} else if (process.env.DEBUG === 'true') {
  console.error(`[Config] Successfully loaded .env from: ${envPath}`);
  console.error(`[Config] Current working directory: ${process.cwd()}`);
  console.error(`[Config] Project root: ${projectRoot}`);
}

/* ---------- Zod schemas for environment-based config ---------- */

const envInt = (fallback: number) =>
  z.string().optional()
    .transform((v) => (v ? parseInt(v, 10) : fallback))
    .pipe(z.number().int().finite());

const envBool = (fallback: boolean) =>
  z.string().optional()
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
  MCP_SERVER_NAME: z.string().optional().default('jshhookmcp'),
  MCP_SERVER_VERSION: z.string().optional().default('0.1.0'),

  // Cache
  ENABLE_CACHE: envBool(false),
  CACHE_DIR: z.string().optional().default('.cache'),
  CACHE_TTL: envInt(3600).pipe(z.number().min(0)),

  // Performance
  MAX_CONCURRENT_ANALYSIS: envInt(3).pipe(z.number().min(1).max(32)),
  MAX_CODE_SIZE_MB: envInt(10).pipe(z.number().min(1).max(500)),
});

export function getConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `  ${i.path.join('.')}: ${i.message}`
    );
    console.error(`[Config] Validation errors:\n${issues.join('\n')}`);
    console.error('[Config] Falling back to safe defaults for invalid fields');
  }

  // Use parsed data if valid, otherwise fall back to process.env with defaults
  const env = parsed.success ? parsed.data : process.env;

  const cacheDir = (env.CACHE_DIR as string) || '.cache';
  const configuredExecutablePath = (
    (env.PUPPETEER_EXECUTABLE_PATH as string) ||
    (env.CHROME_PATH as string) ||
    (env.BROWSER_EXECUTABLE_PATH as string)
  );
  const absoluteCacheDir =
    cacheDir.startsWith('/') || cacheDir.match(/^[A-Za-z]:/)
      ? cacheDir
      : join(projectRoot, cacheDir);

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
      headless: parsed.success ? (env.PUPPETEER_HEADLESS as unknown as boolean) : process.env.PUPPETEER_HEADLESS === 'true',
      timeout: parsed.success ? (env.PUPPETEER_TIMEOUT as unknown as number) : parseInt(process.env.PUPPETEER_TIMEOUT || '30000', 10),
      executablePath: configuredExecutablePath?.trim() || undefined,
    },
    mcp: {
      name: (env.MCP_SERVER_NAME as string) || 'jshhookmcp',
      version: (env.MCP_SERVER_VERSION as string) || '0.1.0',
    },
    cache: {
      enabled: parsed.success ? (env.ENABLE_CACHE as unknown as boolean) : process.env.ENABLE_CACHE === 'true',
      dir: absoluteCacheDir,
      ttl: parsed.success ? (env.CACHE_TTL as unknown as number) : parseInt(process.env.CACHE_TTL || '3600', 10),
    },
    performance: {
      maxConcurrentAnalysis: parsed.success ? (env.MAX_CONCURRENT_ANALYSIS as unknown as number) : parseInt(process.env.MAX_CONCURRENT_ANALYSIS || '3', 10),
      maxCodeSizeMB: parsed.success ? (env.MAX_CODE_SIZE_MB as unknown as number) : parseInt(process.env.MAX_CODE_SIZE_MB || '10', 10),
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

  return { valid: errors.length === 0, errors };
}
