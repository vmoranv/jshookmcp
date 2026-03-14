/**
 * Extension path resolution — root directories for plugins and workflows.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_TS_RUNTIME = import.meta.url.endsWith('.ts');
const EXTENSION_MANAGER_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_INSTALL_ROOT = resolve(EXTENSION_MANAGER_DIR, '..', '..', '..');

export const DEFAULT_PLUGIN_ROOTS = IS_TS_RUNTIME
  ? [join(EXTENSION_INSTALL_ROOT, 'plugins'), join(EXTENSION_INSTALL_ROOT, 'dist', 'plugins')]
  : [join(EXTENSION_INSTALL_ROOT, 'dist', 'plugins'), join(EXTENSION_INSTALL_ROOT, 'plugins')];

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
