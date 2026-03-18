import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const loadedEnvPaths = new Set<string>();

/**
 * Load plugin-local `.env` once per plugin directory.
 *
 * Main process `.env` is loaded by core config bootstrap first, so this only
 * adds per-plugin overrides without clobbering existing values.
 */
export function loadPluginEnv(manifestUrl: string): void {
  const pluginDir = dirname(fileURLToPath(manifestUrl));
  const envPath = join(pluginDir, '.env');

  if (loadedEnvPaths.has(envPath)) return;
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
  loadedEnvPaths.add(envPath);
}
