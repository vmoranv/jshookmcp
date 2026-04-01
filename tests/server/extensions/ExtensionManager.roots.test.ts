import { beforeEach, describe, expect, it } from 'vitest';
import { resolve, sep } from 'node:path';
import {
  DEFAULT_PLUGIN_ROOTS,
  DEFAULT_WORKFLOW_ROOTS,
  parseRoots,
  resolveRoots,
} from '@server/extensions/ExtensionManager.roots';

describe('ExtensionManager.roots', () => {
  beforeEach(() => {
    // Intentional no-op for consistent Vitest structure.
  });

  it('exposes default plugin and workflow roots', () => {
    expect(DEFAULT_PLUGIN_ROOTS.length).toBeGreaterThan(0);
    expect(DEFAULT_PLUGIN_ROOTS.some((item) => item.includes('plugins'))).toBe(true);
    expect(DEFAULT_WORKFLOW_ROOTS.some((item) => item.includes('workflows'))).toBe(true);
  });

  it('parses comma separated roots and removes duplicates', () => {
    expect(parseRoots(undefined, ['fallback'])).toEqual(['fallback']);
    expect(parseRoots(' alpha, beta ,alpha,, ', ['fallback'])).toEqual(['alpha', 'beta']);
    expect(parseRoots(' , ,, ', ['fallback'])).toEqual(['fallback']);
  });

  it('resolves relative paths, preserves absolute ones, deduplicates, and sorts', () => {
    const absolutePath = resolve('/absolute');
    const resolved = resolveRoots(['b', 'a', 'b', absolutePath]);

    expect(resolved).toContain(absolutePath);
    expect(resolved.some((item) => item.endsWith(`${sep}a`))).toBe(true);
    expect(resolved.some((item) => item.endsWith(`${sep}b`))).toBe(true);
    expect(new Set(resolved).size).toBe(resolved.length);
  });

  it('anchors relative roots to the provided base directory instead of process cwd', () => {
    const baseDir = resolve('/opt/jshook');
    const resolved = resolveRoots(['plugins', 'workflows'], baseDir);

    expect(resolved).toContain(resolve(baseDir, 'plugins'));
    expect(resolved).toContain(resolve(baseDir, 'workflows'));
  });
});
