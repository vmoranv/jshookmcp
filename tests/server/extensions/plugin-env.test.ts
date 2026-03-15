import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  existsSync: vi.fn(),
  config: vi.fn(),
  dirname: vi.fn(() => '/plugins/sample'),
  join: vi.fn((_dir: string, file: string) => `/plugins/sample/${file}`),
  fileURLToPath: vi.fn(() => '/plugins/sample/manifest.ts'),
}));

vi.mock('node:fs', () => ({
  existsSync: state.existsSync,
}));

vi.mock('node:path', () => ({
  dirname: state.dirname,
  join: state.join,
}));

vi.mock('node:url', () => ({
  fileURLToPath: state.fileURLToPath,
}));

vi.mock('dotenv', () => ({
  default: {
    config: state.config,
  },
}));

describe('plugin-env', () => {
  beforeEach(() => {
    vi.resetModules();
    state.existsSync.mockReset();
    state.config.mockReset();
    state.dirname.mockClear();
    state.join.mockClear();
    state.fileURLToPath.mockClear();
  });

  it('loads a plugin-local .env file once', async () => {
    state.existsSync.mockReturnValue(true);
    const { loadPluginEnv } = await import('@server/extensions/plugin-env');

    loadPluginEnv('file:///plugins/sample/manifest.ts');
    loadPluginEnv('file:///plugins/sample/manifest.ts');

    expect(state.config).toHaveBeenCalledTimes(1);
    expect(state.config).toHaveBeenCalledWith({
      path: '/plugins/sample/.env',
      override: false,
    });
  });

  it('skips dotenv when the .env file does not exist', async () => {
    state.existsSync.mockReturnValue(false);
    const { loadPluginEnv } = await import('@server/extensions/plugin-env');

    loadPluginEnv('file:///plugins/sample/manifest.ts');

    expect(state.config).not.toHaveBeenCalled();
  });
});
