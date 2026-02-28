import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = resolve('virtual-project-root');

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
}));

vi.mock('./outputPaths.js', () => ({
  getProjectRoot: vi.fn(() => ROOT),
}));

import { mkdir } from 'node:fs/promises';
import { getArtifactDir, getArtifactsRoot, resolveArtifactPath } from './artifacts.js';

describe('artifacts utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-04T05:06:07.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  it('resolves category path and creates directory', async () => {
    const result = await resolveArtifactPath({
      category: 'har',
      toolName: 'network export',
      target: 'user?id=1',
      ext: 'json',
    });

    expect(result.absolutePath).toContain(resolve(ROOT, 'artifacts', 'har'));
    expect(result.displayPath).toMatch(/^artifacts\/har\//);
    expect(result.displayPath).toContain('network_export-user_id_1');
    expect(mkdir).toHaveBeenCalledWith(resolve(ROOT, 'artifacts', 'har'), { recursive: true });
  });

  it('normalizes extensions with leading dot', async () => {
    const result = await resolveArtifactPath({
      category: 'reports',
      toolName: 'reporter',
      ext: '.md',
    });

    expect(result.absolutePath.endsWith('.md')).toBe(true);
    expect(result.absolutePath.includes('..md')).toBe(false);
  });

  it('uses custom directory when inside project root', async () => {
    const result = await resolveArtifactPath({
      category: 'tmp',
      toolName: 'worker',
      ext: 'txt',
      customDir: 'custom/out',
    });

    expect(result.absolutePath).toContain(resolve(ROOT, 'custom', 'out'));
    expect(result.displayPath.startsWith('custom/out/')).toBe(true);
    expect(mkdir).toHaveBeenCalledWith(resolve(ROOT, 'custom', 'out'), { recursive: true });
  });

  it('blocks path traversal for custom directory outside project', async () => {
    await expect(
      resolveArtifactPath({
        category: 'tmp',
        toolName: 'worker',
        ext: 'txt',
        customDir: '../escape',
      })
    ).rejects.toThrow('Path traversal blocked');
  });

  it('trims and sanitizes long file name parts', async () => {
    const result = await resolveArtifactPath({
      category: 'dumps',
      toolName: '***very long tool name***'.repeat(8),
      target: '///target///',
      ext: 'bin',
    });

    const filename = result.displayPath.split('/').pop() ?? '';
    const baseWithoutExt = filename.replace(/\.bin$/, '');
    const [toolPart] = baseWithoutExt.split('-');
    expect(toolPart.length).toBeLessThanOrEqual(60);
    expect(filename).not.toContain('*');
    expect(filename).toContain('target');
  });

  it('returns artifact root helpers', () => {
    expect(getArtifactsRoot()).toBe(resolve(ROOT, 'artifacts'));
    expect(getArtifactDir('wasm')).toBe(resolve(ROOT, 'artifacts', 'wasm'));
  });
});
