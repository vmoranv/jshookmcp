import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  getEphemeralKeylogDir,
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
    delete process.env.NPX_CACHE;
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
    const maliciousAbsolutePath = join(projectRoot, '../../system_files/external-test-output.jpeg');
    const out = await resolveScreenshotOutputPath({
      requestedPath: maliciousAbsolutePath,
      type: 'jpeg',
      fallbackDir: 'screenshots/test-vitest',
    });

    expect(out.absolutePath).toContain('external-test-output.jpeg');
    expect(out.pathRewritten).toBe(true);
  });

  it('adds default extension when missing', async () => {
    const out = await resolveScreenshotOutputPath({
      requestedPath: 'custom_name',
      type: 'jpeg',
    });
    expect(out.absolutePath.endsWith('custom_name.jpg')).toBe(true);
  });

  it('honors relative requested paths inside the project root without nesting under screenshotDir', async () => {
    const out = await resolveScreenshotOutputPath({
      requestedPath: 'screenshots/external/kept-relative',
      type: 'png',
    });

    expect(out.absolutePath).toBe(
      join(projectRoot, 'screenshots', 'external', 'kept-relative.png'),
    );
    expect(out.displayPath).toBe('screenshots/external/kept-relative.png');
    expect(out.pathRewritten).toBe(false);
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

  it('rewrites writes that would follow a symlinked directory outside the project root', async (ctx) => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'outputpaths-symlink-'));
    const linkName = `symlink-escape-${process.pid}-${Date.now()}`;
    const linkPath = join(projectRoot, linkName);

    try {
      try {
        symlinkSync(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        ctx.skip();
        return;
      }

      const out = await resolveScreenshotOutputPath({
        requestedPath: `${linkName}/escape.png`,
        fallbackDir: 'screenshots/test-vitest',
      });

      expect(out.pathRewritten).toBe(true);
      expect(out.absolutePath).not.toContain(linkName);
      expect(out.absolutePath).toBe(join(projectRoot, 'screenshots', 'test-vitest', 'escape.png'));
    } finally {
      rmSync(linkPath, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('issue #77: relative MCP_SCREENSHOT_DIR + relative path lands in cwd under npx context', async () => {
    // Reproduce issue #77: npx / global-install context with a relative
    // screenshot dir. Before the fix, diverging import.meta.url-based
    // projectRoot depths (config ../.. vs outputPaths ..) flattened into one
    // chunk made the file land in the npx cache with pathRewritten:false.
    process.env.NPX_CACHE = '/tmp/.npm/_npx/regression';
    process.env.MCP_SCREENSHOT_DIR = './images';

    const cwd = process.cwd();
    const out = await resolveScreenshotOutputPath({
      requestedPath: 'screenshots/test-fix.png',
      type: 'png',
    });

    // File must land in the user's cwd, never in the npx cache / package root.
    expect(out.absolutePath).toBe(join(cwd, 'screenshots', 'test-fix.png'));
    expect(out.displayPath).toBe('screenshots/test-fix.png');
    expect(out.pathRewritten).toBe(false);
    // Guard against the silent-rewrite symptom from the original bug.
    expect(out.absolutePath).not.toContain('external');
  });

  it('issue #77: project root + relative dir resolve to cwd under npx/global-install context', () => {
    process.env.NPX_CACHE = '/tmp/.npm/_npx/regression';
    expect(getProjectRoot()).toBe(process.cwd());

    const dir = resolveOutputDirectory('./images');
    expect(dir).toBe(join(process.cwd(), 'images'));
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

  it('nests the ephemeral keylog dir under the TLS keylog dir', () => {
    const sealedDir = getEphemeralKeylogDir();
    expect(sealedDir.startsWith(getTlsKeyLogDir())).toBe(true);
    expect(sealedDir.endsWith('sealed')).toBe(true);
  });
});
