import { existsSync } from 'fs';
import puppeteer from 'rebrowser-puppeteer-core';

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
    const candidate = process.env[key]?.trim();
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveFromPuppeteer(): string | undefined {
  try {
    const candidate = puppeteer.executablePath('chrome');
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // no managed/browser channel available in current environment
  }
  return undefined;
}

/**
 * Resolve explicit browser executable path.
 *
 * Returns undefined when no explicit path is configured so callers can
 * fall back to Puppeteer's managed browser behavior.
 */
export function findBrowserExecutable(): string | undefined {
  if (cachedBrowserPath !== null) {
    if (!cachedBrowserPath || existsSync(cachedBrowserPath)) {
      return cachedBrowserPath;
    }
    cachedBrowserPath = null;
  }

  cachedBrowserPath = resolveFromEnvironment() ?? resolveFromPuppeteer();
  return cachedBrowserPath;
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
