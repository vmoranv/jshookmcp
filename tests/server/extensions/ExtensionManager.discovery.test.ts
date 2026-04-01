import type { PathLike } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtureBase = resolve(__dirname, '../../tmp/fixtures');
const pluginRoot = resolve(fixtureBase, 'plugins-root');
const workflowRoot = resolve(fixtureBase, 'workflows-root');
const brokenRoot = resolve(fixtureBase, 'broken-root');
const okRoot = resolve(fixtureBase, 'ok-root');

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

vi.mock('node:fs', () => ({
  existsSync: state.existsSync,
}));

vi.mock('node:fs/promises', () => ({
  readFile: state.readFile,
}));

vi.mock('tinyglobby', () => ({
  glob: state.glob,
}));

describe('ExtensionManager.discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    state.glob.mockReset();
    state.existsSync.mockReset();
    state.existsSync.mockReturnValue(false);
    state.readFile.mockReset();
  });

  it('prefers installed plugin entry metadata over manifest filename guessing', async () => {
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === pluginRoot) {
        return [pluginAlphaMetadata, pluginAlphaManifest, pluginAlphaEntry, pluginBetaManifest];
      }
      return [];
    });
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
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === pluginRoot) {
        return [pluginAlphaMetadata, pluginAlphaManifest, pluginAlphaEntry, pluginBetaManifest];
      }
      return [];
    });
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

    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === brokenRoot) {
        throw new Error('scan failed');
      }
      return [okManifest];
    });
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles([brokenRoot, okRoot])).resolves.toEqual([okManifest]);
  });

  it('ignores metadata files that contain invalid JSON', async () => {
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === pluginRoot) {
        return [pluginAlphaMetadata];
      }
      return [];
    });
    state.readFile.mockResolvedValue('invalid-json');
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');
    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([]);
  });

  it('ignores metadata files where entry string is empty', async () => {
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === pluginRoot) {
        return [pluginAlphaMetadata];
      }
      return [];
    });
    state.readFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        kind: 'plugin',
        slug: 'a',
        id: 'a',
        source: { type: 'git', repo: 'a', ref: 'a', commit: 'a', subpath: '.', entry: '  ' },
      }),
    );
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');
    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([]);
  });

  it('ignores metadata files where entry file does not exist', async () => {
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === pluginRoot) {
        return [pluginAlphaMetadata];
      }
      return [];
    });
    state.readFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        kind: 'plugin',
        slug: 'a',
        id: 'a',
        source: { type: 'git', repo: 'a', ref: 'a', commit: 'a', subpath: '.', entry: 'index.js' },
      }),
    );
    state.existsSync.mockReturnValue(false);
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');
    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([]);
  });

  it('deduplicates correctly when candidate replaces existing file based on priority', async () => {
    const sameDirMeta = resolve(pluginRoot, 'same', '.jshook-install.json');
    const sameDirEntry = resolve(pluginRoot, 'same', 'z.js');
    const sameDirManifest = resolve(pluginRoot, 'same', 'manifest.ts');

    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === pluginRoot) {
        return [sameDirMeta, sameDirManifest, sameDirEntry];
      }
      return [];
    });
    state.readFile.mockImplementation(async (path: string | PathLike) => {
      if (normalizePath(path) === normalizePath(sameDirMeta)) {
        return JSON.stringify({
          version: 1,
          kind: 'plugin',
          slug: 'same',
          id: 'same',
          source: { type: 'git', repo: 'a', ref: 'a', commit: 'a', subpath: '.', entry: 'z.js' },
        });
      }
      throw new Error(`Unexpected`);
    });
    // Both files exist
    state.existsSync.mockImplementation(
      (path: string | PathLike) =>
        normalizePath(path) === normalizePath(sameDirEntry) ||
        normalizePath(path) === normalizePath(sameDirManifest),
    );

    // alphabet order execution: manifest.ts (existing) -> z.js (candidate)
    // Both map to 'plugins-root::same'
    // manifest.ts is priority 1, z.js is priority 0.
    // Candidate priority (0) < Existing priority (1) so it replaces!
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');
    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([sameDirEntry]);
  });
});
