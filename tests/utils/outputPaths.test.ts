import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  getProjectRoot,
  resolveOutputDirectory,
  resolveScreenshotOutputPath,
  getSystemTempRoots,
  getDebuggerSessionsDir,
  getExtensionRegistryDir,
  getCodeCacheDir,
  getTlsKeyLogDir,
} from '@utils/outputPaths';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

describe('outputPaths', () => {
  const projectRoot = getProjectRoot();
  const testRoot = join(projectRoot, 'screenshots', 'test-vitest');

  beforeEach(() => {
    process.env.MCP_SCREENSHOT_DIR = 'screenshots/test-vitest';
  });

  afterEach(async () => {
    delete process.env.MCP_SCREENSHOT_DIR;
    delete process.env.MCP_PROJECT_ROOT;
    await rm(testRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns an absolute project root path', () => {
    expect(isAbsolute(projectRoot)).toBe(true);
  });

  it('honors MCP_PROJECT_ROOT override for project-scoped paths', () => {
    const customRoot = join(projectRoot, 'screenshots', 'test-root-override');
    process.env.MCP_PROJECT_ROOT = customRoot;

    expect(getProjectRoot()).toBe(customRoot);
    expect(resolveOutputDirectory(undefined)).toBe(join(customRoot, 'screenshots'));
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

    expect(out.absolutePath).toContain(
      join('screenshots', 'test-vitest', 'snap-1700000000000.png'),
    );
    expect(out.displayPath).toContain('screenshots/test-vitest/snap-1700000000000.png');
    expect(out.pathRewritten).toBe(true);
  });

  it('rewrites absolute requested paths to safe directory for security', async () => {
    const out = await resolveScreenshotOutputPath({
      requestedPath: 'C:/tmp/screenshots/test-output.jpeg',
      type: 'jpeg',
      fallbackDir: 'screenshots/test-vitest',
    });

    expect(out.absolutePath).toContain('test-output.jpeg');
    expect(out.pathRewritten).toBe(true);
  });

  it('adds default extension when missing', async () => {
    const out = await resolveScreenshotOutputPath({
      requestedPath: 'custom_name',
      type: 'jpeg',
    });
    expect(out.absolutePath.endsWith('custom_name.jpg')).toBe(true);
  });

  it('rewrites traversal attempts outside screenshot root using basename', async () => {
    const out = await resolveScreenshotOutputPath({
      requestedPath: '../system_files/hack.png',
      fallbackDir: 'screenshots/manual',
    });
    expect(out.pathRewritten).toBe(true);
    expect(out.absolutePath.endsWith('hack.png')).toBe(true);
    expect(out.absolutePath).toContain(join('screenshots', 'test-vitest', 'hack.png'));
  });

  it('gets temp roots', () => {
    const roots = getSystemTempRoots();
    expect(Array.isArray(roots)).toBe(true);
    expect(roots.length).toBeGreaterThan(0);
  });

  it('gets config dirs', () => {
    expect(typeof getDebuggerSessionsDir()).toBe('string');
    expect(typeof getExtensionRegistryDir()).toBe('string');
    expect(typeof getCodeCacheDir()).toBe('string');
    expect(typeof getTlsKeyLogDir()).toBe('string');
  });
});
