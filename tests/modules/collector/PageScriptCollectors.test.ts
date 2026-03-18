import { describe, expect, it, vi } from 'vitest';

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

function replaceWindow(value: unknown): () => void {
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

describe('PageScriptCollectors', () => {
  it('extractDependencies parses import/require/dynamic import uniquely', () => {
    const code = `
      import x from './a';
      const y = require("./b");
      const z = import('./a');
    `;
    const deps = extractDependencies(code);
    expect(deps.sort()).toEqual(['./a', './b']);
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
      new workerWindow.Worker('/worker-a.js');
      new workerWindow.Worker(new URL('https://site/worker-b.js'));

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
});
