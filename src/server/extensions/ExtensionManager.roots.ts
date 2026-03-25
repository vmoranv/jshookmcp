/**
 * Extension path resolution — root directories for plugins and workflows.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Walk up the directory tree from the given start to find the project root
 * (the nearest ancestor that contains a package.json).
 *
 * This is robust across both dev (`src/server/extensions/`) and production
 * (`dist/src/server/extensions/`) layouts — no hard-coded level count needed.
 */
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root reached
    dir = parent;
  }
  // Fallback: 4 levels up (handles dist/src/server/extensions/)
  return resolve(startDir, '..', '..', '..', '..');
}

const EXTENSION_MANAGER_DIR = fileURLToPath(new URL('.', import.meta.url));
const EXTENSION_INSTALL_ROOT = findProjectRoot(EXTENSION_MANAGER_DIR);

export const DEFAULT_PLUGIN_ROOTS = [join(EXTENSION_INSTALL_ROOT, 'plugins')];

export const DEFAULT_WORKFLOW_ROOTS = [join(EXTENSION_INSTALL_ROOT, 'workflows')];

export function parseRoots(raw: string | undefined, fallback: string[]): string[] {
  const value = raw?.trim();
  if (!value) return fallback;
  const roots = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return roots.length > 0 ? [...new Set(roots)] : fallback;
}

export function resolveRoots(roots: string[]): string[] {
  const resolved = roots.map((root) => (isAbsolute(root) ? root : resolve(process.cwd(), root)));
  return [...new Set(resolved)].sort((a, b) => a.localeCompare(b));
}
