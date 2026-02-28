import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  getProjectRoot,
  resolveOutputDirectory,
  resolveScreenshotOutputPath,
} from '../../src/utils/outputPaths.js';

describe('outputPaths', () => {
  const projectRoot = getProjectRoot();
  const testRoot = join(projectRoot, 'screenshots', 'test-vitest');

  beforeEach(() => {
    process.env.MCP_SCREENSHOT_DIR = 'screenshots/test-vitest';
  });

  afterEach(async () => {
    delete process.env.MCP_SCREENSHOT_DIR;
    await rm(testRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns an absolute project root path', () => {
    expect(isAbsolute(projectRoot)).toBe(true);
  });

  it('uses fallback screenshots directory when input dir is empty', () => {
    const dir = resolveOutputDirectory(undefined);
    expect(dir).toBe(join(projectRoot, 'screenshots'));
  });

  it('resolves safe relative output directory inside project root', () => {
    const dir = resolveOutputDirectory('screenshots/custom');
    expect(dir).toBe(join(projectRoot, 'screenshots', 'custom'));
  });

  it('guards against traversal and rewrites to safe external path', () => {
    const dir = resolveOutputDirectory('../outside-dir');
    expect(dir).toContain(join(projectRoot, 'screenshots', 'external'));
    expect(dir.endsWith('outside-dir')).toBe(true);
  });

  it('generates default screenshot path with extension when no path provided', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const out = await resolveScreenshotOutputPath({
      fallbackName: 'snap',
      fallbackDir: 'screenshots/test-vitest',
    });

    expect(out.absolutePath).toContain(join('screenshots', 'test-vitest', 'snap-1700000000000.png'));
    expect(out.displayPath).toContain('screenshots/test-vitest/snap-1700000000000.png');
  });

  it('rewrites absolute requested file path to basename under safe root', async () => {
    const out = await resolveScreenshotOutputPath({
      requestedPath: 'C:/tmp/evil-name.jpeg',
      type: 'jpeg',
      fallbackDir: 'screenshots/test-vitest',
    });

    expect(out.absolutePath).toContain(join('screenshots', 'test-vitest', 'evil-name.jpeg'));
    expect(out.displayPath).toContain('screenshots/test-vitest/evil-name.jpeg');
  });
});

