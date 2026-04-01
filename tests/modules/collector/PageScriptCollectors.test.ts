import { describe, expect, it, vi } from 'vitest';
import { logger } from '@src/utils/logger';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import {
  analyzeDependencies,
  calculatePriorityScore,
  collectInlineScripts,
  collectServiceWorkers,
  collectWebWorkers,
  extractDependencies,
  setupWebWorkerTracking,
} from '@modules/collector/PageScriptCollectors';

function replaceWindow(value: any): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'window', originalDescriptor);
      return;
    }

    delete (globalThis as { window?: unknown }).window;
  };
}

type WorkerWindowLike<TWorker extends abstract new (...args: any[]) => any> = {
  Worker: TWorker;
  __workerUrls?: string[];
};

type AnyRecord = Record<string, any>;

function withStubbedGlobals<T>(globals: AnyRecord, run: () => Promise<T> | T): Promise<T> | T {
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const restore = () => {
    for (const [key, descriptor] of previous.entries()) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as AnyRecord)[key];
      }
    }
  };

  try {
    const result = run();
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

describe('PageScriptCollectors', () => {
  it('extractDependencies parses import/require/dynamic import uniquely', () => {
    const code = `
      import x from './a';
      const y = require("./b");
      const z = import('./a');
    `;
    const deps = extractDependencies(code);
    expect(deps.toSorted()).toEqual(['./a', './b']);
  });

  it('analyzeDependencies builds nodes and import edges', () => {
    const files: any[] = [
      { url: 'https://site/a.js', content: `import b from "b";`, type: 'external', size: 10 },
      { url: 'https://site/b.js', content: 'export default 1', type: 'external', size: 10 },
    ];

    const graph = analyzeDependencies(files);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([
      { from: 'https://site/a.js', to: 'https://site/b.js', type: 'import' },
    ]);
  });

  it('calculatePriorityScore rewards meaningful urls and penalizes vendor bundles', () => {
    const high = calculatePriorityScore({
      url: 'https://x/main-crypto-api.js',
      type: 'inline',
      size: 5000,
      content: '',
    } as any);
    const low = calculatePriorityScore({
      url: 'https://x/vendor/ui-framework.bundle.js',
      type: 'external',
      size: 400000,
      content: '',
    } as any);

    expect(high).toBeGreaterThan(low);
  });

  it('calculates priority scores across the major scoring branches', () => {
    expect(
      calculatePriorityScore({
        url: 'https://x/main-index-app-core-util.js',
        type: 'inline',
        size: 5 * 1024,
        content: '',
      } as any),
    ).toBeGreaterThan(
      calculatePriorityScore({
        url: 'https://x/vendor/jquery.bundle.js',
        type: 'external',
        size: 400 * 1024,
        content: '',
      } as any),
    );

    expect(
      calculatePriorityScore({
        url: 'https://x/crypto-encrypt-sign-api-request-ajax.js',
        type: 'external',
        size: 20 * 1024,
        content: '',
      } as any),
    ).toBeGreaterThan(
      calculatePriorityScore({
        url: 'https://x/lib-node_modules-bundle.js',
        type: 'external',
        size: 20 * 1024,
        content: '',
      } as any),
    );
  });

  it('collectInlineScripts applies max file cap and preserves metadata', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue([
        {
          url: 'inline-script-0',
          content: 'a',
          size: 1,
          type: 'inline',
          metadata: { truncated: false },
        },
        {
          url: 'inline-script-1',
          content: 'b',
          size: 1,
          type: 'inline',
          metadata: { truncated: true },
        },
        {
          url: 'inline-script-2',
          content: 'c',
          size: 1,
          type: 'inline',
          metadata: { truncated: false },
        },
      ]),
    } as any;

    const result = await collectInlineScripts(page, 10, 2);
    expect(result).toHaveLength(2);
    expect(result[1]?.metadata?.truncated).toBe(true);
  });

  it('collectInlineScripts executes DOM parsing and truncation logic', async () => {
    const inlineScripts = [
      {
        src: '',
        textContent: 'const a = 1;',
        type: '',
        async: true,
        defer: false,
        integrity: 'sha256-123',
      },
      {
        src: '',
        textContent: 'x'.repeat(80),
        type: 'module',
        async: false,
        defer: true,
        integrity: '',
      },
      {
        src: 'https://cdn.example.com/app.js',
        textContent: '',
        type: '',
        async: false,
        defer: false,
        integrity: '',
      },
    ];
    const documentLike = {
      querySelectorAll: vi.fn((selector: string) => (selector === 'script' ? inlineScripts : [])),
    };
    const page = {
      evaluate: vi.fn(async (callback: (...args: any[]) => any, ...args: any[]) =>
        withStubbedGlobals({ document: documentLike }, () => callback(...args)),
      ),
    } as any;

    const result = await collectInlineScripts(page, 20, 5);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      url: 'inline-script-0',
      content: 'const a = 1;',
      type: 'inline',
      metadata: {
        scriptType: 'text/javascript',
        async: true,
        defer: false,
        integrity: 'sha256-123',
        truncated: false,
      },
    });
    expect(result[1]).toMatchObject({
      url: 'inline-script-1',
      content: 'x'.repeat(20),
      metadata: {
        scriptType: 'module',
        async: false,
        defer: true,
        truncated: true,
        originalSize: 80,
      },
    });
  });

  it('collectServiceWorkers gathers successful worker scripts and skips failed ones', async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce([
          { url: 'https://site/sw-1.js', scope: '/', state: 'activated' },
          { url: 'https://site/sw-2.js', scope: '/', state: 'activated' },
        ])
        .mockResolvedValueOnce('self.addEventListener("fetch",()=>{})')
        .mockRejectedValueOnce(new Error('fetch failed')),
    } as any;

    const files = await collectServiceWorkers(page);
    expect(files).toHaveLength(1);
    expect(files[0]?.type).toBe('service-worker');
    expect(files[0]?.url).toContain('sw-1.js');
  });

  it('collectServiceWorkers filters URLs before fetching worker content', async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce([
          { url: 'https://site/sw-1.js', scope: '/', state: 'activated' },
          { url: 'https://other/sw-2.js', scope: '/', state: 'activated' },
        ])
        .mockResolvedValueOnce('self.addEventListener("fetch",()=>{})'),
    } as any;

    const files = await collectServiceWorkers(page, (url) => url.includes('site'));

    expect(files).toHaveLength(1);
    expect(files[0]?.url).toBe('https://site/sw-1.js');
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('collectWebWorkers resolves relative URLs against current page URL', async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(['/worker.js'])
        .mockResolvedValueOnce('onmessage=()=>{}'),
      url: vi.fn().mockReturnValue('https://site/app/index.html'),
    } as any;

    const files = await collectWebWorkers(page);
    expect(files).toHaveLength(1);
    expect(files[0]?.url).toBe('https://site/worker.js');
    expect(files[0]?.type).toBe('web-worker');
  });

  it('collectWebWorkers filters URLs before fetching worker content', async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(['/allowed-worker.js', 'https://other/blocked-worker.js'])
        .mockResolvedValueOnce('onmessage=()=>{}'),
      url: vi.fn().mockReturnValue('https://site/app/index.html'),
    } as any;

    const files = await collectWebWorkers(page, (url) => url.includes('site'));

    expect(files).toHaveLength(1);
    expect(files[0]?.url).toBe('https://site/allowed-worker.js');
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('collectServiceWorkers and collectWebWorkers execute real browser-side logic', async () => {
    const serviceWorkerRegistrations = [
      {
        scope: '/',
        active: { scriptURL: 'https://site/sw-1.js', state: 'activated' },
        installing: null,
        waiting: null,
      },
      {
        scope: '/',
        active: { scriptURL: 'https://other/sw-2.js', state: 'activated' },
        installing: null,
        waiting: null,
      },
    ];
    const workerUrls = ['/worker-a.js', 'https://site/worker-b.js'];
    const fetchMock = vi.fn(async (url: string) => ({
      text: async () => `// ${url}`,
    }));
    const page = {
      evaluate: vi.fn(async (callback: (...args: any[]) => any, ...args: any[]) =>
        withStubbedGlobals(
          {
            navigator: {
              serviceWorker: {
                getRegistrations: vi.fn(async () => serviceWorkerRegistrations),
              },
            },
            window: { __workerUrls: workerUrls },
            fetch: fetchMock,
          },
          () => callback(...args),
        ),
      ),
      url: vi.fn().mockReturnValue('https://site/app/index.html'),
    } as any;

    const serviceFiles = await collectServiceWorkers(page, (url) => url.includes('site'));
    expect(serviceFiles).toHaveLength(1);
    expect(serviceFiles[0]).toMatchObject({
      url: 'https://site/sw-1.js',
      type: 'service-worker',
      content: '// https://site/sw-1.js',
    });

    const workerFiles = await collectWebWorkers(page, (url) => url.endsWith('worker-b.js'));
    expect(workerFiles).toHaveLength(1);
    expect(workerFiles[0]).toMatchObject({
      url: 'https://site/worker-b.js',
      type: 'web-worker',
      content: '// https://site/worker-b.js',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collectServiceWorkers returns an empty list when service workers are unavailable', async () => {
    const page = {
      evaluate: vi.fn(async (callback: (...args: any[]) => any, ...args: any[]) =>
        withStubbedGlobals(
          {
            navigator: {},
          },
          () => callback(...args),
        ),
      ),
    } as any;

    await expect(collectServiceWorkers(page)).resolves.toEqual([]);
  });

  it('setupWebWorkerTracking installs the worker tracker before navigation', async () => {
    const page = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    } as any;

    await setupWebWorkerTracking(page);
    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
  });

  it('setupWebWorkerTracking preserves Worker constructor semantics while recording URLs', async () => {
    const page = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    } as any;

    await setupWebWorkerTracking(page);

    const installTracking = page.evaluateOnNewDocument.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    expect(installTracking).toBeTypeOf('function');

    class OriginalWorker {
      static marker = 'native-like';
      scriptURL: string;
      options?: WorkerOptions;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        this.scriptURL = typeof scriptURL === 'string' ? scriptURL : scriptURL.toString();
        this.options = options;
      }
    }

    const workerWindow = { Worker: OriginalWorker } as unknown as WorkerWindowLike<
      typeof OriginalWorker
    >;
    const restoreWindow = replaceWindow(workerWindow);

    try {
      installTracking?.();

      expect(workerWindow.Worker).not.toBe(OriginalWorker);
      expect(workerWindow.Worker.marker).toBe('native-like');
      expect(workerWindow.Worker.prototype).toBe(OriginalWorker.prototype);

      const worker = new workerWindow.Worker('/worker.js', { type: 'module' });

      expect(worker).toBeInstanceOf(OriginalWorker);
      expect(worker).toBeInstanceOf(workerWindow.Worker);
      expect(worker.scriptURL).toBe('/worker.js');
      expect(worker.options).toEqual({ type: 'module' });
      expect(workerWindow.__workerUrls).toEqual(['/worker.js']);
    } finally {
      restoreWindow();
    }
  });

  it('setupWebWorkerTracking reuses pre-existing worker URL storage', async () => {
    const page = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    } as any;

    await setupWebWorkerTracking(page);

    const installTracking = page.evaluateOnNewDocument.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    expect(installTracking).toBeTypeOf('function');

    class OriginalWorker {
      constructor(readonly scriptURL: string | URL) {}
    }

    const existingUrls = ['/existing-worker.js'];
    const workerWindow = {
      Worker: OriginalWorker,
      __workerUrls: existingUrls,
    } as unknown as WorkerWindowLike<typeof OriginalWorker>;
    const restoreWindow = replaceWindow(workerWindow);

    try {
      installTracking?.();

      const trackedUrls = workerWindow.__workerUrls;
      const workerA = new workerWindow.Worker('/worker-a.js');
      const workerB = new workerWindow.Worker(new URL('https://site/worker-b.js'));

      expect(workerA).toBeInstanceOf(OriginalWorker);
      expect(workerB).toBeInstanceOf(OriginalWorker);
      expect(trackedUrls).toBe(existingUrls);
      expect(workerWindow.__workerUrls).toBe(existingUrls);
      expect(workerWindow.__workerUrls).toEqual([
        '/existing-worker.js',
        '/worker-a.js',
        'https://site/worker-b.js',
      ]);
    } finally {
      restoreWindow();
    }
  });

  it('setupWebWorkerTracking preserves native constructor failures', async () => {
    const page = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    } as any;

    await setupWebWorkerTracking(page);

    const installTracking = page.evaluateOnNewDocument.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    expect(installTracking).toBeTypeOf('function');

    class OriginalWorker {
      static readonly kind = 'worker';

      constructor(scriptURL: string | URL) {
        if (typeof scriptURL !== 'string' && !(scriptURL instanceof URL)) {
          throw new TypeError('invalid scriptURL');
        }
      }
    }

    const workerWindow = {
      Worker: OriginalWorker,
      __workerUrls: [] as string[],
    } as unknown as WorkerWindowLike<typeof OriginalWorker>;
    const restoreWindow = replaceWindow(workerWindow);

    try {
      installTracking?.();

      expect(() => new workerWindow.Worker(undefined as never)).toThrow('invalid scriptURL');
      expect(workerWindow.__workerUrls).toEqual([]);
    } finally {
      restoreWindow();
    }
  });

  it('setupWebWorkerTracking no-ops when Worker is unavailable', async () => {
    const page = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    } as any;

    await setupWebWorkerTracking(page);

    const installTracking = page.evaluateOnNewDocument.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    expect(installTracking).toBeTypeOf('function');

    const workerWindow = { Worker: undefined } as unknown as Window & {
      __workerUrls?: string[];
      Worker: typeof Worker;
    };
    const restoreWindow = replaceWindow(workerWindow);

    try {
      expect(() => installTracking?.()).not.toThrow();
      expect(workerWindow.__workerUrls).toBeUndefined();
    } finally {
      restoreWindow();
    }
  });

  it('collectWebWorkers logs warning when individual worker fetch fails', async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(['/worker.js'])
        .mockRejectedValueOnce(new Error('network error')),
      url: vi.fn().mockReturnValue('https://site/app/index.html'),
    } as any;

    const files = await collectWebWorkers(page);
    // fetch threw for the single worker URL — no files collected, no crash
    expect(files).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to collect Web Worker: /worker.js',
      expect.any(Error),
    );
  });

  it('collectWebWorkers returns empty array when outer evaluate throws', async () => {
    const page = {
      evaluate: vi.fn().mockRejectedValue(new Error('evaluate failed')),
      url: vi.fn().mockReturnValue('https://site/app/index.html'),
    } as any;

    await expect(collectWebWorkers(page)).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('Web Worker collection failed', expect.any(Error));
  });

  it('collectInlineScripts filter covers !src=true && textContent=false branch', async () => {
    // A script with no src but empty textContent exercises the textContent
    // short-circuit branch inside the filter callback (line 55).
    const inlineScripts = [
      {
        src: '',
        textContent: 'const a = 1;',
        type: 'text/javascript',
        async: false,
        defer: false,
        integrity: '',
      },
      {
        src: '',
        textContent: '', // !src=true but textContent=false — covers short-circuit branch
        type: 'text/javascript',
        async: false,
        defer: false,
        integrity: '',
      },
    ];
    const documentLike = {
      querySelectorAll: vi.fn((selector: string) => (selector === 'script' ? inlineScripts : [])),
    };
    const page = {
      evaluate: vi.fn(async (callback: (...args: any[]) => any, ...args: any[]) =>
        withStubbedGlobals({ document: documentLike }, () => callback(...args)),
      ),
    } as any;

    const result = await collectInlineScripts(page, 1024, 10);
    // Only the script with actual textContent survives the filter
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe('inline-script-0');
  });

  it('collectServiceWorkers returns empty array when outer evaluate throws', async () => {
    const page = {
      evaluate: vi.fn().mockRejectedValue(new Error('evaluate failed')),
    } as any;

    await expect(collectServiceWorkers(page)).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('Service Worker collection failed', expect.any(Error));
  });

  it('collectInlineScripts does not warn when script count is within the limit', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue([
        {
          url: 'inline-script-0',
          content: 'a',
          size: 1,
          type: 'inline',
          metadata: { truncated: false },
        },
      ]),
    } as any;

    await collectInlineScripts(page, 10, 5);
    // scripts.length (1) <= maxFilesPerCollect (5) — the > branch is false
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('analyzeDependencies skips dependencies with no matching target file', () => {
    const files: any[] = [
      { url: 'https://site/main.js', content: `import 'vendor/lib';`, type: 'external', size: 10 },
    ];
    const graph = analyzeDependencies(files);
    // 'vendor/lib' does not match 'main.js' via includes/endsWith — targetFile is undefined
    // so the `if (targetFile)` block is not executed (covers false branch)
    expect(graph.edges).toHaveLength(0);
  });

  it('calculatePriorityScore covers file size 10KB–50KB range', () => {
    // file.size < 50 * 1024 triggers the line 268 branch
    const score = calculatePriorityScore({
      url: 'https://x/main-api.js', // no vendor penalty
      type: 'external',
      size: 20 * 1024, // 20KB — hits the < 50KB branch
      content: '',
    } as any);
    // Score: 5 (external) + 10 (size 10-50KB) + 20 (main) + 25 (api) = 60
    expect(score).toBe(60);
  });
});
