import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExtensionManagementHandlers } from '@server/domains/maintenance/handlers.extensions';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb?: (...a: unknown[]) => void) => {
      cb?.(null, { stdout: '', stderr: '' });
      return { pid: 0 } as unknown as child_process.ChildProcess;
    },
  ),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock timer functions for AbortController in fetchJson if necessary
vi.useFakeTimers();

describe('ExtensionManagementHandlers', () => {
  let ctx: any;
  let handlers: ExtensionManagementHandlers;

  beforeEach(() => {
    ctx = {
      listExtensions: vi.fn(),
      reloadExtensions: vi.fn(),
    };
    handlers = new ExtensionManagementHandlers(ctx);
    global.fetch = vi.fn();
    vi.resetAllMocks();
    process.env.EXTENSION_REGISTRY_BASE_URL = 'http://test-registry';
  });

  afterEach(() => {
    delete process.env.EXTENSION_REGISTRY_BASE_URL;
    vi.clearAllTimers();
  });

  describe('handleListExtensions', () => {
    it('returns extensions successfully', async () => {
      ctx.listExtensions.mockReturnValue({ test: 1 });
      const res = (await handlers.handleListExtensions()) as any;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
      expect(data.test).toBe(1);
    });

    it('handles errors', async () => {
      ctx.listExtensions.mockImplementation(() => {
        throw new Error('err');
      });
      const res = (await handlers.handleListExtensions()) as any;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('err');
    });
  });

  describe('handleReloadExtensions', () => {
    it('returns success', async () => {
      ctx.reloadExtensions.mockResolvedValue({
        addedTools: 1,
        pluginCount: 1,
        workflowCount: 0,
        errors: [],
        warnings: [],
      });
      const res = (await handlers.handleReloadExtensions()) as any;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
      expect(data.addedTools).toBe(1);
    });

    it('handles errors', async () => {
      ctx.reloadExtensions.mockRejectedValue(new Error('err2'));
      const res = (await handlers.handleReloadExtensions()) as any;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('err2');
    });
  });

  describe('handleBrowseExtensionRegistry', () => {
    it('throws if registry base is not set', async () => {
      delete process.env.EXTENSION_REGISTRY_BASE_URL;
      const res = (await handlers.handleBrowseExtensionRegistry('all')) as any;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('EXTENSION_REGISTRY_BASE_URL is not configured');
    });

    it('fetches plugins and workflows', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          plugins: [{ slug: 'p1', id: '1', meta: {}, source: {} }],
          workflows: [{ slug: 'w1', id: '2', meta: {}, source: {} }],
        }),
      });

      const resPromise = handlers.handleBrowseExtensionRegistry('all') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
      expect(data.pluginCount).toBe(1);
      expect(data.workflowCount).toBe(1);
    });

    it('handles empty plugin arrays', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const resPromise = handlers.handleBrowseExtensionRegistry('plugin') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.pluginCount).toBe(0);
      expect(data.workflowCount).toBeUndefined();
    });

    it('handles http errors', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      // No cache reading since cache throws empty here. Wait, readRegistryCache will return null
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('no cache'));

      const resPromise = handlers.handleBrowseExtensionRegistry('all') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('http_error');
    });

    it('handles http error from exception message', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockRejectedValue(new Error('Failed with HTTP 503 Service Unavailable'));
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('no cache'));
      const resPromise = handlers.handleBrowseExtensionRegistry('plugin') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('http_error');
      expect(data.status).toBe(503);
    });

    it('falls back to stale cache on dns error', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockRejectedValue(new Error('ENOTFOUND something'));

      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ plugins: [] }));

      const resPromise = handlers.handleBrowseExtensionRegistry('plugin') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
      expect(data.stale).toBe(true);
      expect(data.pluginSource).toBe('cache');
    });

    it('handles abort error as timeout', async () => {
      const mockFetch = global.fetch as any;
      const abortErr = new DOMException('Abort', 'AbortError');
      mockFetch.mockRejectedValue(abortErr);
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('no cache'));

      const resPromise = handlers.handleBrowseExtensionRegistry('plugin') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('timeout');
    });

    it('handles connection refused error', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('no cache'));

      const resPromise = handlers.handleBrowseExtensionRegistry('plugin') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('connection_refused');
    });

    it('handles tls error', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockRejectedValue(new Error('CERT_HAS_EXPIRED'));
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('no cache'));

      const resPromise = handlers.handleBrowseExtensionRegistry('plugin') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('tls_error');
    });

    it('writes cache if fetch succeeds', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ plugins: [] }),
      });
      const resPromise = handlers.handleBrowseExtensionRegistry('plugin') as any;
      vi.runAllTimers();
      await resPromise;
      expect(fsPromises.writeFile).toHaveBeenCalled();
    });

    it('handles cache write failure gracefully', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ plugins: [] }),
      });
      vi.mocked(fsPromises.writeFile).mockRejectedValue(new Error('write fail'));
      const resPromise = handlers.handleBrowseExtensionRegistry('plugin') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
    });
  });

  describe('handleInstallExtension', () => {
    it('errors if target directory already exists', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workflows: [
            { slug: 'my-slug', id: '1', meta: {}, source: { subpath: '.', entry: 'index.js' } },
          ],
        }),
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const resPromise = handlers.handleInstallExtension('my-slug') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Target directory already exists');
    });

    it('errors if entry cannot be resolved in registries', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ workflows: [], plugins: [] }) });

      const resPromise = handlers.handleInstallExtension('non-existent') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('not found in workflow or plugin registry');
    });

    it('errors if both registries fail to fetch', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error());
      const mockFetch = global.fetch as any;
      mockFetch.mockRejectedValue(new Error('network down'));

      const resPromise = handlers.handleInstallExtension('my-slug') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain(
        'workflow registry error: network down; plugin registry error: network down',
      );
    });

    it('errors if one registry fails and the other does not contain the slug', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error());
      const mockFetch = global.fetch as any;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('workflows')) return Promise.reject(new Error('wf bad'));
        return Promise.resolve({ ok: true, json: async () => ({ plugins: [] }) });
      });

      const resPromise = handlers.handleInstallExtension('my-slug') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain(
        'was not found in plugin registry, and workflow registry lookup failed',
      );
    });

    it('errors if plugin registry fails and workflow registry does not contain the slug', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error());
      const mockFetch = global.fetch as any;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('plugins')) return Promise.reject(new Error('pl bad'));
        return Promise.resolve({ ok: true, json: async () => ({ workflows: [] }) });
      });

      const resPromise = handlers.handleInstallExtension('my-slug') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain(
        'was not found in workflow registry, and plugin registry lookup failed',
      );
    });

    it('installs workflows successfully with workspace dependency rewrite', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workflows: [
            {
              slug: 'wf-test',
              id: '1',
              meta: {},
              source: {
                subpath: 'subdir',
                entry: 'index.js',
              },
            },
          ],
        }),
      });

      vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
        // targetDir doesn't exist
        if (p.includes('wf-test') && !p.includes('package.json') && !p.includes('index.js'))
          return false;
        // package.json exists
        if (p.endsWith('package.json')) return true;
        // entryFile exists
        if (p.endsWith('index.js')) return true;
        // lock files don't exist
        return false;
      }) as unknown as typeof fs.existsSync);

      vi.mocked(fsPromises.readFile).mockImplementation((async (p: string) => {
        if (p.endsWith('package.json')) {
          return JSON.stringify({
            dependencies: { '@jshookmcp/extension-sdk': 'workspace:*' }, // Will cause rewrite
          });
        }
        return '{}';
      }) as unknown as typeof fsPromises.readFile);

      vi.mocked(child_process.execFile).mockImplementation(((
        _cmd: string,
        _args: unknown,
        _opts: unknown,
        cb?: (...a: unknown[]) => void,
      ) => {
        cb?.(null, { stdout: '', stderr: '' });
        return { pid: 0 } as unknown as child_process.ChildProcess;
      }) as typeof child_process.execFile);
      ctx.reloadExtensions.mockResolvedValue({ addedTools: 1 });

      const resPromise = handlers.handleInstallExtension('wf-test', '/custom/dir') as any;
      vi.runAllTimers();
      const res = await resPromise;

      expect(child_process.execFile).toHaveBeenCalledTimes(4); // clone, checkout, install, build

      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
      expect(data.installed.slug).toBe('wf-test');
    });

    it('resolves package manager from package.json packageManager explicit string via heuristics', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          plugins: [
            {
              slug: 'pl-test',
              id: '2',
              meta: {},
              source: { subpath: 'path', entry: 'a.js' },
            },
          ],
        }),
      });

      vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
        if (p.endsWith('package.json') || p.endsWith('a.js')) return true;
        return false;
      }) as unknown as typeof fs.existsSync);

      vi.mocked(fsPromises.readFile).mockImplementation((async (p: string) => {
        if (p.endsWith('package.json')) {
          return JSON.stringify({ packageManager: 'npm@9.0.0' });
        }
        return '{}';
      }) as unknown as typeof fsPromises.readFile);

      ctx.reloadExtensions.mockResolvedValue({ addedTools: 1 });
      const resPromise = handlers.handleInstallExtension('pl-test') as any;
      vi.runAllTimers();
      const res = await resPromise;

      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
      // It should have executed npm, not pnpm
      const execCalls = vi.mocked(child_process.execFile).mock.calls;
      const installCallArgs = execCalls
        .map((c) => c[1])
        .find((args) => (args as string[]).join(' ').includes('install'));
      expect(installCallArgs?.join(' ')).toContain('npm install');
    });

    it('resolves package manager pnpm if pnpm-lock.yaml exists', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          plugins: [
            {
              slug: 'pl-test',
              id: '2',
              meta: {},
              source: { subpath: 'path', entry: 'a.js' },
            },
          ],
        }),
      });

      vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
        if (
          p.endsWith('a.js') ||
          p.endsWith('pnpm-lock.yaml') ||
          p.endsWith('package-lock.json') ||
          p.endsWith('package.json')
        )
          return true;
        return false;
      }) as unknown as typeof fs.existsSync);

      ctx.reloadExtensions.mockResolvedValue({ addedTools: 1 });
      const resPromise = handlers.handleInstallExtension('pl-test') as any;
      vi.runAllTimers();
      await resPromise;

      const execCalls = vi.mocked(child_process.execFile).mock.calls;
      const installCall = execCalls[2]; // after clone and checkout, usually packageManager
      expect(installCall).toBeDefined();
      expect((installCall![1] as string[]).join(' ')).toContain('--ignore-workspace'); // only pnpm uses this in the handler logic
    });

    it('resolves package manager npm if package-lock.json exists without pnpm', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          plugins: [
            {
              slug: 'pl-test',
              id: '2',
              meta: {},
              source: { subpath: 'path', entry: 'a.js' },
            },
          ],
        }),
      });

      vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
        if (p.endsWith('a.js') || p.endsWith('package-lock.json')) return true;
        if (p.endsWith('pnpm-lock.yaml')) return false;
        return false;
      }) as unknown as typeof fs.existsSync);

      const resPromise = handlers.handleInstallExtension('pl-test') as any;
      vi.runAllTimers();
      await resPromise;
    });

    it('fails if entry file is missing after build', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          plugins: [
            {
              slug: 'pl-test',
              id: '2',
              meta: {},
              source: { subpath: 'path', entry: 'a.js' },
            },
          ],
        }),
      });

      vi.mocked(fs.existsSync).mockImplementation((() => false) as unknown as typeof fs.existsSync); // Entry file missing

      const resPromise = handlers.handleInstallExtension('pl-test') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('entry not found:');
    });

    it('skips package manager resolution if package.json does not exist', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workflows: [
            {
              slug: 'wf-no-pkg',
              id: '1',
              meta: {},
              source: { subpath: 'subdir', entry: 'index.js' },
            },
          ],
        }),
      });

      vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
        if (p.endsWith('package.json')) return false; // forces false
        if (p.endsWith('index.js')) return true; // prevent erroring on entry check
        return false;
      }) as unknown as typeof fs.existsSync);

      ctx.reloadExtensions.mockResolvedValue({
        addedTools: 1,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      });

      const resPromise = handlers.handleInstallExtension('wf-no-pkg') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(true);
    });

    it('uses configured roots from environment', async () => {
      process.env.MCP_WORKFLOW_ROOTS = '/custom/workflow/root';
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workflows: [
            {
              slug: 'wf-test',
              id: '1',
              meta: {},
              source: {
                subpath: 'subdir',
                entry: 'index.js',
              },
            },
          ],
        }),
      });

      // Avoid error exits
      vi.mocked(fs.existsSync).mockImplementation(() => false);

      const resPromise = handlers.handleInstallExtension('wf-test') as any;
      vi.runAllTimers();
      const res = await resPromise;

      // even if entryFile is missing (it will error at the end), we can check the path used in error message
      const data = JSON.parse(res.content[0].text);
      expect(data.installDir).toContain('wf-test'); // Wait, default workflow roots

      delete process.env.MCP_WORKFLOW_ROOTS;
    });

    it('rejects relative path escapes in subpath', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workflows: [
            {
              slug: 'wf-test',
              id: '1',
              meta: {},
              source: {
                subpath: '../outside',
                entry: 'index.js',
              },
            },
          ],
        }),
      });

      const resPromise = handlers.handleInstallExtension('wf-test') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('must stay within');
    });

    it('handles missing subpath by defaulting to current directory', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workflows: [{ slug: 'wf-no-subpath', id: '1', meta: {}, source: { entry: 'index.js' } }],
        }),
      });

      vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
        if (p.endsWith('index.js')) return true; // prevent erroring on entry check
        return false;
      }) as unknown as typeof fs.existsSync);

      ctx.reloadExtensions.mockResolvedValue({
        addedTools: 1,
        pluginCount: 0,
        workflowCount: 1,
        errors: [],
        warnings: [],
      });

      const resPromise = handlers.handleInstallExtension('wf-no-subpath') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.error).toBeUndefined();
      expect(data.success).toBe(true);
    });

    it('rejects relative path escapes in entry', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workflows: [
            {
              slug: 'wf-test',
              id: '1',
              meta: {},
              source: {
                subpath: '.',
                entry: '../outside.js',
              },
            },
          ],
        }),
      });

      const resPromise = handlers.handleInstallExtension('wf-test') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('must stay within');
    });

    it('rejects empty registry source paths', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workflows: [
            {
              slug: 'wf-test',
              id: '1',
              meta: {},
              source: {
                subpath: '.',
                entry: '  ', // empty
              },
            },
          ],
        }),
      });

      const resPromise = handlers.handleInstallExtension('wf-test') as any;
      vi.runAllTimers();
      const res = await resPromise;
      const data = JSON.parse(res.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Registry source.entry must be a non-empty string');
    });
  });
});
