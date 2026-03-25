import type { PathLike } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pluginRoot = resolve('.tmp-tests', 'plugins-root');
const workflowRoot = resolve('.tmp-tests', 'workflows-root');
const brokenRoot = resolve('.tmp-tests', 'broken-root');
const okRoot = resolve('.tmp-tests', 'ok-root');

const pluginAlphaMetadata = resolve(pluginRoot, 'alpha', '.jshook-install.json');
const pluginAlphaManifest = resolve(pluginRoot, 'alpha', 'manifest.ts');
const pluginAlphaEntry = resolve(pluginRoot, 'alpha', 'dist', 'index.js');
const pluginBetaManifest = resolve(pluginRoot, 'beta', 'manifest.js');

const workflowAlphaMetadata = resolve(workflowRoot, 'alpha', '.jshook-install.json');
const workflowAlphaManifest = resolve(workflowRoot, 'alpha', 'workflow.ts');
const workflowAlphaEntry = resolve(workflowRoot, 'alpha', 'dist', 'index.js');
const workflowBetaManifest = resolve(workflowRoot, 'beta', 'build.workflow.js');

const normalizePath = (value: string | PathLike) => String(value).replace(/\\/g, '/');

const state = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string | PathLike) => boolean>(() => false),
  glob: vi.fn(),
  readFile: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:fs', () => ({
  existsSync: state.existsSync,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:fs/promises', () => ({
  readFile: state.readFile,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('tinyglobby', () => ({
  glob: state.glob,
}));

describe('ExtensionManager.discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.glob.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.existsSync.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.existsSync.mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.readFile.mockReset();
  });

  it('prefers installed plugin entry metadata over manifest filename guessing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === pluginRoot) {
        return [pluginAlphaMetadata, pluginAlphaManifest, pluginAlphaEntry, pluginBetaManifest];
      }
      return [];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.readFile.mockImplementation(async (path: string | PathLike) => {
      if (normalizePath(path) === normalizePath(pluginAlphaMetadata)) {
        return JSON.stringify({
          version: 1,
          kind: 'plugin',
          slug: 'alpha',
          id: 'plugin.alpha.v1',
          source: {
            type: 'git',
            repo: 'https://example.com/alpha.git',
            ref: 'main',
            commit: 'abc123',
            subpath: '.',
            entry: 'dist/index.js',
          },
        });
      }
      throw new Error(`Unexpected read: ${String(path)}`);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.existsSync.mockImplementation(
      (path: string | PathLike) => normalizePath(path) === normalizePath(pluginAlphaEntry),
    );
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([
      pluginAlphaEntry,
      pluginBetaManifest,
    ]);
  });

  it('prefers installed workflow entry metadata over workflow filename guessing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === workflowRoot) {
        return [
          workflowAlphaMetadata,
          workflowAlphaManifest,
          workflowAlphaEntry,
          workflowBetaManifest,
        ];
      }
      return [];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.readFile.mockImplementation(async (path: string | PathLike) => {
      if (normalizePath(path) === normalizePath(workflowAlphaMetadata)) {
        return JSON.stringify({
          version: 1,
          kind: 'workflow',
          slug: 'alpha',
          id: 'workflow.alpha.v1',
          source: {
            type: 'git',
            repo: 'https://example.com/alpha.git',
            ref: 'main',
            commit: 'abc123',
            subpath: '.',
            entry: 'dist/index.js',
          },
        });
      }
      throw new Error(`Unexpected read: ${String(path)}`);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.existsSync.mockImplementation(
      (path: string | PathLike) => normalizePath(path) === normalizePath(workflowAlphaEntry),
    );
    const { discoverWorkflowFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverWorkflowFiles([workflowRoot])).resolves.toEqual([
      workflowAlphaEntry,
      workflowBetaManifest,
    ]);
  });

  it('falls back to legacy scans when installed metadata is invalid or missing output', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === pluginRoot) {
        return [pluginAlphaMetadata, pluginAlphaManifest, pluginAlphaEntry, pluginBetaManifest];
      }
      return [];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.readFile.mockResolvedValue('{"kind":"plugin"}');
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([
      pluginAlphaManifest,
      pluginBetaManifest,
    ]);
  });

  it('discovers workflow manifests in both workflow.* and *.workflow.* forms', async () => {
    const workflowA = resolve(workflowRoot, 'a', 'workflow.ts');
    const workflowB = resolve(workflowRoot, 'b', 'build.workflow.js');
    const workflowC = resolve(workflowRoot, 'c', 'workflow.md');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === workflowRoot) {
        return [workflowA, workflowB, workflowC];
      }
      return [];
    });
    const { discoverWorkflowFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverWorkflowFiles([workflowRoot])).resolves.toEqual([workflowA, workflowB]);
  });

  it('skips roots whose glob scan fails', async () => {
    const okManifest = resolve(okRoot, 'plugin', 'manifest.ts');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === brokenRoot) {
        throw new Error('scan failed');
      }
      return [okManifest];
    });
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles([brokenRoot, okRoot])).resolves.toEqual([okManifest]);
  });
});
