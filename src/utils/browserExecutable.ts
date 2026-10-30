import { existsSync } from 'node:fs';
import { readEnvNullableString } from '@src/config/environment';
import { logger } from './logger';

/**
 * Browser executable resolution policy:
 * - Never scan host-installed browsers.
 * - Only honor explicit overrides from environment variables.
 * - Otherwise let Puppeteer handle browser resolution internally.
 */

const ENV_KEYS = ['CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH', 'BROWSER_EXECUTABLE_PATH'] as const;

// null = not resolved yet; undefined = resolved but not configured
let cachedBrowserPath: string | undefined | null = null;

function resolveFromEnvironment(): string | undefined {
  for (const key of ENV_KEYS) {
    const candidate = readEnvNullableString(key, { trim: true });
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

let cachedExecutablePath: typeof import('rebrowser-puppeteer-core').executablePath | null = null;
async function resolveFromPuppeteer(): Promise<string | undefined> {
  try {
    if (!cachedExecutablePath) {
      const puppeteer = await import('rebrowser-puppeteer-core');
      cachedExecutablePath = puppeteer.executablePath;
    }
    const candidate = await cachedExecutablePath('chrome');
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  } catch (error) {
    // Best-effort probe. Log at debug level and — importantly — do NOT mark the
    // cache as resolved: a transient failure (import error, missing managed
    // browser) must stay retryable by later calls instead of poisoning the
    // cache with a stale "no browser" answer.
    logger.debug(`[browserExecutable] Puppeteer resolution failed: ${String(error)}`);
  }
  return undefined;
}

/** Single-flight guard: concurrent async callers share one puppeteer probe. */
let asyncResolutionInFlight: Promise<string | undefined> | null = null;

/**
 * Resolve explicit browser executable path (sync).
 *
 * Returns undefined when no explicit path is configured so callers can
 * fall back to Puppeteer's managed browser behavior.
 *
 * Puppeteer-based resolution is only attempted on the first async call
 * via {@link findBrowserExecutableAsync}.
 */
export function findBrowserExecutable(): string | undefined {
  if (cachedBrowserPath !== null) {
    if (!cachedBrowserPath || existsSync(cachedBrowserPath)) {
      return cachedBrowserPath;
    }
    cachedBrowserPath = null;
  }

  cachedBrowserPath = resolveFromEnvironment();
  return cachedBrowserPath ?? undefined;
}

/**
 * Async variant that also probes Puppeteer's managed browser path.
 */
export async function findBrowserExecutableAsync(): Promise<string | undefined> {
  const sync = findBrowserExecutable();
  if (sync) return sync;

  if (!asyncResolutionInFlight) {
    asyncResolutionInFlight = resolveFromPuppeteer()
      .then((candidate) => {
        // Commit only successful resolutions to the cache. A failed probe
        // leaves the cache unresolved (null) so a later call can retry.
        if (candidate) cachedBrowserPath = candidate;
        return candidate ?? undefined;
      })
      .finally(() => {
        asyncResolutionInFlight = null;
      });
  }
  return asyncResolutionInFlight;
}

/**
 * Clear browser path cache.
 */
export function clearBrowserPathCache(): void {
  cachedBrowserPath = null;
}

/**
 * Get cached browser path if available.
 */
export function getCachedBrowserPath(): string | undefined {
  return cachedBrowserPath ?? undefined;
}

/**
 * Backward-compatible alias.
 */
export const resolveBrowserExecutablePath = findBrowserExecutable;
