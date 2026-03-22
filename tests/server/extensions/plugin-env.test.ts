import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  existsSync: vi.fn(),
  config: vi.fn(),
  dirname: vi.fn(() => '/plugins/sample'),
  join: vi.fn((_dir: string, file: string) => `/plugins/sample/${file}`),
  fileURLToPath: vi.fn(() => '/plugins/sample/manifest.ts'),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:fs', () => ({
  existsSync: state.existsSync,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:path', () => ({
  dirname: state.dirname,
  join: state.join,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:url', () => ({
  fileURLToPath: state.fileURLToPath,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('dotenv', () => ({
  default: {
    config: state.config,
  },
}));

describe('plugin-env', () => {
  beforeEach(() => {
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.existsSync.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.config.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.dirname.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.join.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.fileURLToPath.mockClear();
  });

  it('loads a plugin-local .env file once', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.existsSync.mockReturnValue(false);
    const { loadPluginEnv } = await import('@server/extensions/plugin-env');

    loadPluginEnv('file:///plugins/sample/manifest.ts');

    expect(state.config).not.toHaveBeenCalled();
  });
});
