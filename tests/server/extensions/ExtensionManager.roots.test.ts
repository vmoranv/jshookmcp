import { beforeEach, describe, expect, it } from 'vitest';
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
  });

  it('resolves relative paths, preserves absolute ones, deduplicates, and sorts', () => {
    const resolved = resolveRoots(['b', 'a', 'b', 'D:\\absolute']);

    expect(resolved[0]).toBe('D:\\absolute');
    expect(resolved.some((item) => item.endsWith('\\a'))).toBe(true);
    expect(resolved.some((item) => item.endsWith('\\b'))).toBe(true);
    expect(new Set(resolved).size).toBe(resolved.length);
  });
});
