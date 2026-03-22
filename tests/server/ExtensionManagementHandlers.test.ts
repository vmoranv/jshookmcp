import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PathLike } from 'node:fs';

const { execFileMock, existsSyncMock, mkdirMock, readFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (
      _file: string,
      _args: string[],
      options: unknown,
      callback?: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      const done = typeof options === 'function' ? (options as typeof callback) : callback;
      done?.(null, '', '');
    }
  ),
  existsSyncMock: vi.fn<(path: string | PathLike) => boolean>(() => false),
  mkdirMock: vi.fn(async () => undefined),
  readFileMock: vi.fn(async () => JSON.stringify({ packageManager: 'pnpm@10.28.2' })),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ExtensionManagementHandlers } from '@server/domains/maintenance/handlers.extensions';

describe('ExtensionManagementHandlers', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    execFileMock.mockClear();
    existsSyncMock.mockClear();
    existsSyncMock.mockReturnValue(false);
    process.env = { ...originalEnv };
    global.fetch = vi.fn(async (url: string | URL | Request) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ plugins: [], workflows: [] }),
      url: String(url),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    })) as any;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('reads EXTENSION_REGISTRY_BASE_URL at call time instead of import time', async () => {
    delete process.env.EXTENSION_REGISTRY_BASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new ExtensionManagementHandlers({} as any);

    process.env.EXTENSION_REGISTRY_BASE_URL = 'https://vmoranv.github.io/jshookmcp/registry';
    const response = await handlers.handleBrowseExtensionRegistry('plugin');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://vmoranv.github.io/jshookmcp/registry/plugins.index.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((response.content[0] as any).type).toBe('text');
    expect((response.content[0] as unknown).text).toContain('"success": true');
  });

  it('installs workflow extension when workflow slug is found during concurrent registry lookup', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL = 'https://vmoranv.github.io/jshookmcp/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const textUrl = String(url);
      if (textUrl.endsWith('/workflows.index.json')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            workflows: [
              {
                slug: 'web-api-capture-session',
                id: 'workflow.web-api-capture-session.v1',
                source: {
                  type: 'git',
                  repo: 'https://github.com/vmoranv/jshook_workflow_web_api_capture_session',
                  ref: 'main',
                  commit: 'abc123',
                  subpath: '.',
                  entry: 'dist/index.js',
                },
                meta: {
                  name: 'Web API Capture Session',
                  description: 'workflow',
                  author: 'tester',
                  source_repo: 'https://github.com/vmoranv/jshook_workflow_web_api_capture_session',
                },
              },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${textUrl}`);
    }) as typeof fetch;

    const response = await handlers.handleInstallExtension('web-api-capture-session');
    const content = response.content[0] as { type: string; text: string };
    const body = JSON.parse(content.text) as { success: boolean };

    expect(body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://vmoranv.github.io/jshookmcp/registry/workflows.index.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://vmoranv.github.io/jshookmcp/registry/plugins.index.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        'clone',
        'https://github.com/vmoranv/jshook_workflow_web_api_capture_session',
        expect.stringContaining('workflows'),
      ],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function)
    );
    expect(ctx.reloadExtensions).toHaveBeenCalledOnce();
  });

  it('falls back to plugin registry when workflow lookup fails during concurrent registry lookup', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL = 'https://vmoranv.github.io/jshookmcp/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 1,
        workflowCount: 0,
        errors: [],
        warnings: [],
      })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const textUrl = String(url);
      if (textUrl.endsWith('/workflows.index.json')) {
        throw new Error('workflow registry unavailable');
      }
      if (textUrl.endsWith('/plugins.index.json')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            plugins: [
              {
                slug: 'ida-bridge',
                id: 'plugin.ida-bridge.v1',
                source: {
                  type: 'git',
                  repo: 'https://github.com/vmoranv/jshook_plugin_ida_bridge',
                  ref: 'main',
                  commit: 'def456',
                  subpath: '.',
                  entry: 'dist/index.js',
                },
                meta: {
                  name: 'IDA Bridge',
                  description: 'plugin',
                  author: 'tester',
                  source_repo: 'https://github.com/vmoranv/jshook_plugin_ida_bridge',
                },
              },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${textUrl}`);
    }) as typeof fetch;

    const response = await handlers.handleInstallExtension('ida-bridge');
    const content = response.content[0] as { type: string; text: string };
    const body = JSON.parse(content.text) as { success: boolean };

    expect(body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        'clone',
        'https://github.com/vmoranv/jshook_plugin_ida_bridge',
        expect.stringContaining('plugins'),
      ],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function)
    );
  });

  it('uses powershell wrapper for package manager commands on Windows', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL = 'https://vmoranv.github.io/jshookmcp/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);

    existsSyncMock.mockImplementation((value: string | PathLike) => {
      const path = String(value);
      return path.endsWith('package.json');
    });

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        workflows: [
          {
            slug: 'batch-register',
            id: 'workflow.batch-register.v1',
            source: {
              type: 'git',
              repo: 'https://github.com/vmoranv/jshook_workflow_batch_register',
              ref: 'main',
              commit: 'abc123',
              subpath: '.',
              entry: 'workflow.ts',
            },
            meta: {
              name: 'Batch Register',
              description: 'workflow',
              author: 'tester',
              source_repo: 'https://github.com/vmoranv/jshook_workflow_batch_register',
            },
          },
        ],
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    })) as any;

    const response = await handlers.handleInstallExtension('batch-register');
    const content = response.content[0] as { type: string; text: string };
    const body = JSON.parse(content.text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    const thirdCall = execFileMock.mock.calls[2];
    const fourthCall = execFileMock.mock.calls[3];

    if (process.platform === 'win32') {
      expect(thirdCall).toEqual([
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'pnpm --ignore-workspace install --no-frozen-lockfile',
        ],
        expect.objectContaining({
          cwd: expect.stringContaining('workflows'),
          env: expect.objectContaining({ CI: 'true' }),
        }),
        expect.any(Function),
      ]);
      expect(fourthCall).toEqual([
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'pnpm --ignore-workspace run --if-present build',
        ],
        expect.objectContaining({
          cwd: expect.stringContaining('workflows'),
          env: expect.objectContaining({ CI: 'true' }),
        }),
        expect.any(Function),
      ]);
    } else {
      expect(thirdCall).toEqual([
        'pnpm',
        ['--ignore-workspace', 'install', '--no-frozen-lockfile'],
        expect.objectContaining({
          cwd: expect.stringContaining('workflows'),
          env: expect.objectContaining({ CI: 'true' }),
        }),
        expect.any(Function),
      ]);
      expect(fourthCall).toEqual([
        'pnpm',
        ['--ignore-workspace', 'run', '--if-present', 'build'],
        expect.objectContaining({
          cwd: expect.stringContaining('workflows'),
          env: expect.objectContaining({ CI: 'true' }),
        }),
        expect.any(Function),
      ]);
    }
  });
});
