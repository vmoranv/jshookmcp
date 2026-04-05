import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PathLike } from 'node:fs';

const normalizePath = (value: string | PathLike) => String(value).replace(/\\/g, '/');

const { execFileMock, existsSyncMock, mkdirMock, readFileMock, writeFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (
      _file: string,
      _args: string[],
      options: any,
      callback?: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const done = typeof options === 'function' ? (options as typeof callback) : callback;
      done?.(null, '', '');
    },
  ),
  existsSyncMock: vi.fn<(path: string | PathLike) => boolean>(() => false),
  mkdirMock: vi.fn(async () => undefined),
  readFileMock: vi.fn(async () => JSON.stringify({ packageManager: 'pnpm@10.28.2' })),
  writeFileMock: vi.fn(async () => undefined),
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
  writeFile: writeFileMock,
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
    mkdirMock.mockClear();
    readFileMock.mockClear();
    readFileMock.mockResolvedValue(JSON.stringify({ packageManager: 'pnpm@10.28.2' }));
    writeFileMock.mockClear();
    process.env = { ...originalEnv };
    global.fetch = vi.fn(async (url: string | URL | Request) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ plugins: [], workflows: [] }),
      url: String(url),
    })) as any;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('reads EXTENSION_REGISTRY_BASE_URL at call time instead of import time', async () => {
    delete process.env.EXTENSION_REGISTRY_BASE_URL;
    const handlers = new ExtensionManagementHandlers({} as any);

    process.env.EXTENSION_REGISTRY_BASE_URL =
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry';
    const response = await handlers.handleBrowseExtensionRegistry('plugin');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry/plugins.index.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect((response.content[0] as any).type).toBe('text');
    expect((response.content[0] as any).text).toContain('"success": true');
  });

  it('installs workflow extension when workflow slug is found during concurrent registry lookup', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL =
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      })),
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);
    existsSyncMock.mockImplementation((value: string | PathLike) => {
      const path = normalizePath(value);
      return path.endsWith('/package.json') || path.endsWith('/dist/workflow.js');
    });

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
                  entry: 'workflow.ts',
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
    const body = JSON.parse(content.text) as {
      success: boolean;
      installed: { entry: string; entryFile: string };
    };

    expect(body.success).toBe(true);
    expect(body.installed.entry).toBe('dist/workflow.js');
    expect(normalizePath(body.installed.entryFile)).toContain('/dist/workflow.js');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry/workflows.index.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry/plugins.index.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const metadataCall = writeFileMock.mock.calls.find((call) =>
      // @ts-expect-error — auto-suppressed [TS2352, TS2493]
      normalizePath(call[0] as string).endsWith(
        '/workflows/web-api-capture-session/.jshook-install.json',
      ),
    );
    expect(metadataCall).toBeDefined();
    // @ts-expect-error — auto-suppressed [TS18048, TS2352, TS2493]
    expect(normalizePath(metadataCall[0] as string)).toContain(
      '/workflows/web-api-capture-session/.jshook-install.json',
    );
    // @ts-expect-error — auto-suppressed [TS18048, TS2493]
    expect(metadataCall[1]).toContain('"entry": "dist/workflow.js"');
    // @ts-expect-error — auto-suppressed [TS18048, TS2493]
    expect(metadataCall[2]).toBe('utf8');
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        'clone',
        'https://github.com/vmoranv/jshook_workflow_web_api_capture_session',
        expect.stringContaining('workflows'),
      ],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    );
    expect(ctx.reloadExtensions).toHaveBeenCalledOnce();
  });

  it('falls back to plugin registry when workflow lookup fails during concurrent registry lookup', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL =
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 1,
        workflowCount: 0,
        errors: [],
        warnings: [],
      })),
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);
    existsSyncMock.mockImplementation((value: string | PathLike) => {
      const path = normalizePath(value);
      return path.endsWith('/package.json') || path.endsWith('/dist/manifest.js');
    });

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
                  entry: 'manifest.ts',
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
    const body = JSON.parse(content.text) as {
      success: boolean;
      installed: { entry: string; entryFile: string };
    };

    expect(body.success).toBe(true);
    expect(body.installed.entry).toBe('dist/manifest.js');
    expect(normalizePath(body.installed.entryFile)).toContain('/dist/manifest.js');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const metadataCall = writeFileMock.mock.calls.find((call) =>
      // @ts-expect-error — auto-suppressed [TS2352, TS2493]
      normalizePath(call[0] as string).endsWith('/plugins/ida-bridge/.jshook-install.json'),
    );
    expect(metadataCall).toBeDefined();
    // @ts-expect-error — auto-suppressed [TS18048, TS2352, TS2493]
    expect(normalizePath(metadataCall[0] as string)).toContain(
      '/plugins/ida-bridge/.jshook-install.json',
    );
    // @ts-expect-error — auto-suppressed [TS18048, TS2493]
    expect(metadataCall[1]).toContain('"kind": "plugin"');
    // @ts-expect-error — auto-suppressed [TS18048, TS2493]
    expect(metadataCall[1]).toContain('"entry": "dist/manifest.js"');
    // @ts-expect-error — auto-suppressed [TS18048, TS2493]
    expect(metadataCall[2]).toBe('utf8');
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        'clone',
        'https://github.com/vmoranv/jshook_plugin_ida_bridge',
        expect.stringContaining('plugins'),
      ],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    );
  });

  it('uses powershell wrapper for package manager commands on Windows', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL =
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      })),
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);

    existsSyncMock.mockImplementation((value: string | PathLike) => {
      const path = normalizePath(value);
      return path.endsWith('/package.json') || path.endsWith('/workflow.ts');
    });

    // @ts-expect-error — auto-suppressed [TS2352]
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
    })) as any;

    const response = await handlers.handleInstallExtension('batch-register');
    const content = response.content[0] as { type: string; text: string };
    const body = JSON.parse(content.text);
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

  it('uses source.subpath as package manager cwd and metadata root', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL =
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      })),
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);

    existsSyncMock.mockImplementation((value: string | PathLike) => {
      const path = normalizePath(value);
      return (
        path.endsWith('/packages/workflow/package.json') ||
        path.endsWith('/packages/workflow/dist/index.js')
      );
    });

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        workflows: [
          {
            slug: 'nested-flow',
            id: 'workflow.nested-flow.v1',
            source: {
              type: 'git',
              repo: 'https://github.com/vmoranv/jshook_workflow_nested_flow',
              ref: 'main',
              commit: 'ghi789',
              subpath: 'packages/workflow',
              entry: 'dist/index.js',
            },
            meta: {
              name: 'Nested Flow',
              description: 'workflow',
              author: 'tester',
              source_repo: 'https://github.com/vmoranv/jshook_workflow_nested_flow',
            },
          },
        ],
      }),
    })) as typeof fetch;

    const response = await handlers.handleInstallExtension('nested-flow');
    const content = response.content[0] as { type: string; text: string };
    const body = JSON.parse(content.text) as {
      success: boolean;
      installed: { projectDir: string; metadataPath: string; entryFile: string };
    };

    expect(body.success).toBe(true);
    expect(normalizePath(body.installed.projectDir)).toContain(
      '/workflows/nested-flow/packages/workflow',
    );
    const thirdCall = execFileMock.mock.calls[2];
    const fourthCall = execFileMock.mock.calls[3];
    // @ts-expect-error — auto-suppressed [TS18048]
    expect(normalizePath(thirdCall[2].cwd as string)).toContain(
      '/workflows/nested-flow/packages/workflow',
    );
    // @ts-expect-error — auto-suppressed [TS18048]
    expect(normalizePath(fourthCall[2].cwd as string)).toContain(
      '/workflows/nested-flow/packages/workflow',
    );
    const metadataCall = writeFileMock.mock.calls.find((call) =>
      // @ts-expect-error — auto-suppressed [TS2352, TS2493]
      normalizePath(call[0] as string).endsWith(
        '/workflows/nested-flow/packages/workflow/.jshook-install.json',
      ),
    );
    expect(metadataCall).toBeDefined();
    // @ts-expect-error — auto-suppressed [TS18048, TS2352, TS2493]
    expect(normalizePath(metadataCall[0] as string)).toContain(
      '/workflows/nested-flow/packages/workflow/.jshook-install.json',
    );
    // @ts-expect-error — auto-suppressed [TS18048, TS2493]
    expect(metadataCall[1]).toContain('"subpath": "packages/workflow"');
    // @ts-expect-error — auto-suppressed [TS18048, TS2493]
    expect(metadataCall[2]).toBe('utf8');
  });

  it('fails install when declared registry entry is missing after build', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL =
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      })),
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        workflows: [
          {
            slug: 'broken-flow',
            id: 'workflow.broken-flow.v1',
            source: {
              type: 'git',
              repo: 'https://github.com/vmoranv/jshook_workflow_broken_flow',
              ref: 'main',
              commit: 'zzz999',
              subpath: '.',
              entry: 'dist/index.js',
            },
            meta: {
              name: 'Broken Flow',
              description: 'workflow',
              author: 'tester',
              source_repo: 'https://github.com/vmoranv/jshook_workflow_broken_flow',
            },
          },
        ],
      }),
    })) as typeof fetch;

    const response = await handlers.handleInstallExtension('broken-flow');
    const content = response.content[0] as { type: string; text: string };
    const body = JSON.parse(content.text) as { success: boolean; error: string };

    expect(body.success).toBe(false);
    expect(body.error).toContain('Installed extension entry not found');
    expect(
      writeFileMock.mock.calls.some((call) =>
        // @ts-expect-error — auto-suppressed [TS2352, TS2493]
        normalizePath(call[0] as string).endsWith('/broken-flow/.jshook-install.json'),
      ),
    ).toBe(false);
    expect(ctx.reloadExtensions).not.toHaveBeenCalled();
  });

  it('fails install before clone when registry entry escapes project root', async () => {
    process.env.EXTENSION_REGISTRY_BASE_URL =
      'https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry';
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        addedTools: 0,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      })),
    } as any;
    const handlers = new ExtensionManagementHandlers(ctx);

    // @ts-expect-error — auto-suppressed [TS2352]
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        workflows: [
          {
            slug: 'escape-flow',
            id: 'workflow.escape-flow.v1',
            source: {
              type: 'git',
              repo: 'https://github.com/vmoranv/jshook_workflow_escape_flow',
              ref: 'main',
              commit: 'escape123',
              subpath: '.',
              entry: '../outside.js',
            },
            meta: {
              name: 'Escape Flow',
              description: 'workflow',
              author: 'tester',
              source_repo: 'https://github.com/vmoranv/jshook_workflow_escape_flow',
            },
          },
        ],
      }),
    })) as typeof fetch;

    const response = await handlers.handleInstallExtension('escape-flow');
    const content = response.content[0] as { type: string; text: string };
    const body = JSON.parse(content.text) as { success: boolean; error: string };

    expect(body.success).toBe(false);
    expect(body.error).toContain('source.entry must stay within');
    expect(execFileMock).not.toHaveBeenCalled();
    expect(
      writeFileMock.mock.calls.some((call) =>
        // @ts-expect-error — auto-suppressed [TS2352, TS2493]
        normalizePath(call[0] as string).endsWith('/escape-flow/.jshook-install.json'),
      ),
    ).toBe(false);
    expect(ctx.reloadExtensions).not.toHaveBeenCalled();
  });
});
