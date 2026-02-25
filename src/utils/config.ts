import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import type { Config } from '../types/index.js';

const currentFilename = fileURLToPath(import.meta.url);
const currentDirname = dirname(currentFilename);
const projectRoot = join(currentDirname, '..', '..');

const envPath = join(projectRoot, '.env');
const result = dotenvConfig({ path: envPath });

if (result.error) {
  console.error(`[Config] Warning: Failed to load .env file from ${envPath}`);
  console.error(`[Config] Error: ${result.error.message}`);
  console.error('[Config] Will use environment variables or defaults');
} else if (process.env.DEBUG === 'true') {
  console.error(`[Config] Successfully loaded .env from: ${envPath}`);
  console.error(`[Config] Current working directory: ${process.cwd()}`);
  console.error(`[Config] Project root: ${projectRoot}`);
}

export function getConfig(): Config {
  const cacheDir = process.env.CACHE_DIR || '.cache';
  const configuredExecutablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.BROWSER_EXECUTABLE_PATH;
  const absoluteCacheDir =
    cacheDir.startsWith('/') || cacheDir.match(/^[A-Za-z]:/)
      ? cacheDir
      : join(projectRoot, cacheDir);

  return {
    llm: {
      provider: (process.env.DEFAULT_LLM_PROVIDER as 'openai' | 'anthropic') || 'openai',
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
        baseURL: process.env.OPENAI_BASE_URL,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
        baseURL: process.env.ANTHROPIC_BASE_URL,
      },
    },
    puppeteer: {
      headless: process.env.PUPPETEER_HEADLESS === 'true',
      timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '30000', 10),
      executablePath: configuredExecutablePath?.trim() || undefined,
    },
    mcp: {
      name: process.env.MCP_SERVER_NAME || 'jshhookmcp',
      version: process.env.MCP_SERVER_VERSION || '0.1.0',
    },
    cache: {
      enabled: process.env.ENABLE_CACHE === 'true',
      dir: absoluteCacheDir,
      ttl: parseInt(process.env.CACHE_TTL || '3600', 10),
    },
    performance: {
      maxConcurrentAnalysis: parseInt(process.env.MAX_CONCURRENT_ANALYSIS || '3', 10),
      maxCodeSizeMB: parseInt(process.env.MAX_CODE_SIZE_MB || '10', 10),
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

  return { valid: errors.length === 0, errors };
}
