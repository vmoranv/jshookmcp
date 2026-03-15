import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  glob: vi.fn(),
}));

vi.mock('tinyglobby', () => ({
  glob: state.glob,
}));

describe('ExtensionManager.discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    state.glob.mockReset();
  });

  it('discovers plugin manifests and prefers js over ts in duplicate dist candidates', async () => {
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === '/plugins') {
        return [
          '/plugins/alpha/manifest.ts',
          '/plugins/alpha/dist/manifest.js',
          '/plugins/beta/manifest.js',
          '/plugins/ignore/readme.md',
        ];
      }
      return [];
    });
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles(['/plugins'])).resolves.toEqual([
      '/plugins/alpha/dist/manifest.js',
      '/plugins/beta/manifest.js',
    ]);
  });

  it('discovers workflow manifests in both workflow.* and *.workflow.* forms', async () => {
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === '/workflows') {
        return [
          '/workflows/a/workflow.ts',
          '/workflows/b/build.workflow.js',
          '/workflows/c/workflow.md',
        ];
      }
      return [];
    });
    const { discoverWorkflowFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverWorkflowFiles(['/workflows'])).resolves.toEqual([
      '/workflows/a/workflow.ts',
      '/workflows/b/build.workflow.js',
    ]);
  });

  it('skips roots whose glob scan fails', async () => {
    state.glob.mockImplementation(async (_pattern: string, options: { cwd: string }) => {
      if (options.cwd === '/broken') {
        throw new Error('scan failed');
      }
      return ['/ok/plugin/manifest.ts'];
    });
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles(['/broken', '/ok'])).resolves.toEqual([
      '/ok/plugin/manifest.ts',
    ]);
  });
});
