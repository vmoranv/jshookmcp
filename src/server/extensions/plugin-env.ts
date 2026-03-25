import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const loadedEnvPaths = new Set<string>();

function toManifestUrl(manifestLocation: string): URL {
  return manifestLocation.startsWith('file:')
    ? new URL(manifestLocation)
    : pathToFileURL(manifestLocation);
}

/**
 * Load plugin-local `.env` once per plugin directory.
 *
 * Main process `.env` is loaded by core config bootstrap first, so this only
 * adds per-plugin overrides without clobbering existing values.
 */
export function loadPluginEnv(manifestLocation: string): void {
  const pluginDirUrl = new URL('.', toManifestUrl(manifestLocation));
  const pluginDir = fileURLToPath(pluginDirUrl);
  const envPath = join(pluginDir, '.env');

  if (loadedEnvPaths.has(envPath)) return;
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
  loadedEnvPaths.add(envPath);
}
