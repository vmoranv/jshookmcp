import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const collectorHelpers = vi.hoisted(() => ({
  collectInlineScripts: vi.fn(async (): Promise<MockCollectedFile[]> => []),
  collectServiceWorkers: vi.fn(async (): Promise<MockCollectedFile[]> => []),
  collectWebWorkers: vi.fn(async (): Promise<MockCollectedFile[]> => []),
  analyzeDependencies: vi.fn(
    (files: Array<{ url: string }>): MockDependencyGraph => ({
      nodes: files.map((file) => ({ id: file.url, url: file.url, type: 'external' })),
      edges: [],
    })
  ),
  setupWebWorkerTracking: vi.fn(async () => undefined),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@modules/collector/PageScriptCollectors', () => ({
  collectInlineScripts: collectorHelpers.collectInlineScripts,
  collectServiceWorkers: collectorHelpers.collectServiceWorkers,
  collectWebWorkers: collectorHelpers.collectWebWorkers,
  analyzeDependencies: collectorHelpers.analyzeDependencies,
  setupWebWorkerTracking: collectorHelpers.setupWebWorkerTracking,
}));

import { collectInnerImpl } from '@modules/collector/CodeCollectorCollectInternal';

interface MockCollectedFile {
  url: string;
  content: string;
  size: number;
  type: string;
  metadata?: Record<string, unknown>;
}

interface MockCodeSummary {
  url: string;
  size: number;
  type: string;
  hasEncryption: boolean;
  hasAPI: boolean;
  hasObfuscation: boolean;
  functions: string[];
  imports: string[];
  preview: string;
}

interface MockDependencyGraph {
  nodes: Array<{ id: string; url: string; type: string }>;
  edges: Array<{ from: string; to: string; type: 'import' }>;
}

type MockSmartCollectResult = Array<MockCollectedFile | MockCodeSummary>;

function createPageAndSession() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const session = {
    send: vi.fn(async () => ({})),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      const group = listeners.get(event) ?? new Set<(payload: unknown) => void>();
      group.add(handler);
      listeners.set(event, group);
    }),
    off: vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    detach: vi.fn(async () => {}),
  };
  const page = {
    setDefaultTimeout: vi.fn(),
    setUserAgent: vi.fn(async () => {}),
    createCDPSession: vi.fn(async () => session),
    goto: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };

  return { page, session };
}

type ResponseListener = (params: unknown) => Promise<void> | void;

interface HarnessOptions {
  responseBodies?: Record<string, { body: string; base64Encoded?: boolean }>;
  gotoResponses?: Array<{
    response: { url: string; mimeType?: string };
    requestId: string;
    type?: string;
  }>;
  concurrentGotoResponses?: boolean;
  responseBodyDelayMs?: number;
  cacheEnabled?: boolean;
  cachedResult?: unknown;
}

function createHarness(options: HarnessOptions = {}) {
  let responseListener: ResponseListener | undefined;
  const responseBodies = options.responseBodies ?? {
    'req-1': {
      body: 'console.log("req-1")',
      base64Encoded: false,
    },
    'req-2': {
      body: 'console.log("req-2")',
      base64Encoded: false,
    },
  };
  const gotoResponses = options.gotoResponses ?? [
    {
      response: { url: 'https://site/app.js', mimeType: 'application/javascript' },
      requestId: 'req-1',
      type: 'Script',
    },
    {
      response: { url: 'https://blocked/skip.js', mimeType: 'application/javascript' },
      requestId: 'req-2',
      type: 'Script',
    },
  ];

  const cdpSession = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Network.getResponseBody') {
        if (options.responseBodyDelayMs && options.responseBodyDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.responseBodyDelayMs));
        }
        return responseBodies[String(params?.requestId)] ?? { body: '', base64Encoded: false };
      }
      return {};
    }),
    on: vi.fn((event: string, handler: ResponseListener) => {
      if (event === 'Network.responseReceived') {
        responseListener = handler;
      }
    }),
    off: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };

  const page = {
    setDefaultTimeout: vi.fn(),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn().mockResolvedValue(cdpSession),
    goto: vi.fn(async () => {
      if (!responseListener) return;

      if (options.concurrentGotoResponses) {
        await Promise.all(gotoResponses.map((response) => responseListener!(response)));
        return;
      }

      for (const response of gotoResponses) {
        await responseListener(response);
      }
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const self = {
    cacheEnabled: options.cacheEnabled ?? false,
    cache: {
      get: vi.fn().mockResolvedValue(options.cachedResult ?? null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    init: vi.fn().mockResolvedValue(undefined),
    browser: {
      newPage: vi.fn().mockResolvedValue(page),
    },
    config: {
      timeout: 1000,
    },
    userAgent: 'ua',
    applyAntiDetection: vi.fn().mockResolvedValue(undefined),
    cdpSession: null,
    cdpListeners: {},
    MAX_FILES_PER_COLLECT: 10,
    MAX_SINGLE_FILE_SIZE: 1000,
    collectedUrls: new Set<string>(),
    cleanupCollectedUrls: vi.fn(),
    shouldCollectUrl: vi.fn((url: string, filterRules?: string[]) => {
      if (!filterRules || filterRules.length === 0) {
        return true;
      }
      return filterRules.some((rule) => url.includes(rule));
    }),
    collectedFilesCache: new Map<string, unknown>(),
    smartCollector: {
      smartCollect: vi.fn(async (): Promise<MockSmartCollectResult> => []),
    },
    compressor: {
      shouldCompress: vi.fn().mockReturnValue(false),
      compressBatch: vi.fn().mockResolvedValue([]),
      getStats: vi.fn().mockReturnValue({
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        averageRatio: 0,
        cacheHits: 0,
        cacheMisses: 0,
      }),
    },
  };

  return { cdpSession, page, self };
}

describe('CodeCollector collect internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectorHelpers.collectInlineScripts.mockResolvedValue([]);
    collectorHelpers.collectServiceWorkers.mockResolvedValue([]);
    collectorHelpers.collectWebWorkers.mockResolvedValue([]);
    collectorHelpers.analyzeDependencies.mockImplementation((files: Array<{ url: string }>) => ({
      nodes: files.map((file) => ({ id: file.url, url: file.url, type: 'external' })),
      edges: [],
    }));
    collectorHelpers.setupWebWorkerTracking.mockResolvedValue(undefined);
  });

  it('returns cached results before initializing the browser flow', async () => {
    const cachedResult = {
      files: [
        {
          url: 'https://site/cached.js',
          content: 'cached',
          size: 6,
          type: 'external',
        },
      ],
      dependencies: { nodes: [], edges: [] },
      totalSize: 6,
      collectTime: 1,
    };
    const { self } = createHarness({
      cacheEnabled: true,
      cachedResult,
    });

    const result = await collectInnerImpl(self, {
      url: 'https://site',
    });

    expect(result).toBe(cachedResult);
    expect(self.cache.get).toHaveBeenCalledTimes(1);
    expect(self.init).not.toHaveBeenCalled();
    expect(self.browser.newPage).not.toHaveBeenCalled();
  });

  it('throws when initialization completes without a browser instance', async () => {
    const ctx = {
      cacheEnabled: false,
      cache: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
      },
      init: vi.fn(async () => {}),
      browser: null,
      config: {},
      userAgent: 'ua',
      applyAntiDetection: vi.fn(async () => {}),
      shouldCollectUrl: vi.fn(() => true),
    };

    await expect(
      collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as any,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as any
      )
    ).rejects.toThrow('Browser not initialized');
  });

  it('returns smart summary results and cleans up the page and cdp session', async () => {
    const { page, session } = createPageAndSession();
    const ctx = {
      cacheEnabled: true,
      cache: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
      },
      init: vi.fn(async () => {}),
      browser: {
        newPage: vi.fn(async () => page),
      },
      config: { timeout: 5000 },
      userAgent: 'ua',
      applyAntiDetection: vi.fn(async () => {}),
      cdpSession: null,
      cdpListeners: {},
      MAX_FILES_PER_COLLECT: 5,
      MAX_SINGLE_FILE_SIZE: 1024,
      collectedUrls: new Set<string>(),
      cleanupCollectedUrls: vi.fn(),
      shouldCollectUrl: vi.fn(() => true),
      collectedFilesCache: new Map(),
      smartCollector: {
        smartCollect: vi.fn(async () => [
          {
            url: 'https://example.com/app.js',
            size: 10,
            type: 'external',
            hasEncryption: false,
            hasAPI: true,
            hasObfuscation: false,
            functions: [],
            imports: [],
            preview: 'code',
          },
        ]),
      },
      compressor: {
        shouldCompress: vi.fn(() => false),
        compressBatch: vi.fn(async () => []),
        getStats: vi.fn(() => ({
          totalOriginalSize: 0,
          totalCompressedSize: 0,
          averageRatio: 0,
          cacheHits: 0,
          cacheMisses: 0,
        })),
      },
    };

    const result = await collectInnerImpl(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      ctx as any,
      {
        url: 'https://example.com',
        smartMode: 'summary',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any
    );

    expect(result).toEqual({
      files: [],
      summaries: [
        expect.objectContaining({
          url: 'https://example.com/app.js',
          hasAPI: true,
        }),
      ],
      dependencies: { nodes: [], edges: [] },
      totalSize: 0,
      collectTime: expect.any(Number),
    });
    expect(session.detach).toHaveBeenCalled();
    expect(page.close).toHaveBeenCalled();
  });

  it('preserves web worker setup before navigation', async () => {
    const { page, self } = createHarness();

    await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: true,
    });

    expect(collectorHelpers.setupWebWorkerTracking).toHaveBeenCalledWith(page);
    expect(collectorHelpers.setupWebWorkerTracking.mock.invocationCallOrder[0]).toBeLessThan(
      page.goto.mock.invocationCallOrder[0]!
    );
  });

  it('honors includeExternal=false for CDP script collection', async () => {
    const { self } = createHarness();

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeExternal: false,
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
    });

    expect(result.files).toEqual([]);
    expect(self.collectedFilesCache.size).toBe(0);
  });

  it('skips web worker tracking and collection when includeWebWorker=false', async () => {
    const { self } = createHarness();
    collectorHelpers.collectWebWorkers.mockResolvedValue([
      {
        url: 'https://site/worker.js',
        content: 'worker',
        size: 6,
        type: 'web-worker',
      },
    ]);

    await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
    });

    expect(collectorHelpers.setupWebWorkerTracking).not.toHaveBeenCalled();
    expect(collectorHelpers.collectWebWorkers).not.toHaveBeenCalled();
  });

  it('applies filterRules and global file cap across all collector sources', async () => {
    const { self } = createHarness();
    self.MAX_FILES_PER_COLLECT = 2;
    collectorHelpers.collectInlineScripts.mockResolvedValue([
      { url: 'inline-script-0', content: 'a', size: 1, type: 'inline' },
      { url: 'inline-script-1', content: 'b', size: 1, type: 'inline' },
    ]);
    collectorHelpers.collectServiceWorkers.mockResolvedValue([
      { url: 'https://site/sw.js', content: 'sw', size: 2, type: 'service-worker' },
    ]);

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: true,
      includeServiceWorker: true,
      includeWebWorker: false,
      filterRules: ['site'],
    });

    expect(result.files).toHaveLength(2);
    expect(result.files.some((file) => file.url.includes('blocked'))).toBe(false);
    expect(result.files.some((file) => file.url.includes('sw.js'))).toBe(false);
  });

  it('applies filterRules and global file cap to web worker collection', async () => {
    const { self } = createHarness({
      gotoResponses: [],
    });
    self.MAX_FILES_PER_COLLECT = 1;
    collectorHelpers.collectWebWorkers.mockResolvedValue([
      { url: 'https://site/worker-0.js', content: 'worker-0', size: 8, type: 'web-worker' },
      { url: 'https://other/worker-1.js', content: 'worker-1', size: 8, type: 'web-worker' },
      { url: 'https://site/worker-2.js', content: 'worker-2', size: 8, type: 'web-worker' },
    ]);

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: true,
      filterRules: ['site'],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files.some((file) => file.url.includes('https://other/'))).toBe(false);
    expect(result.files[0]).toMatchObject({
      url: 'https://site/worker-0.js',
      type: 'web-worker',
    });
  });

  it('enforces the global file cap for concurrent external script responses', async () => {
    const { self } = createHarness({
      concurrentGotoResponses: true,
      responseBodyDelayMs: 5,
      gotoResponses: [
        {
          response: { url: 'https://site/app-a.js', mimeType: 'application/javascript' },
          requestId: 'req-1',
          type: 'Script',
        },
        {
          response: { url: 'https://site/app-b.js', mimeType: 'application/javascript' },
          requestId: 'req-2',
          type: 'Script',
        },
      ],
    });
    self.MAX_FILES_PER_COLLECT = 1;

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
    });

    expect(result.files).toHaveLength(1);
    expect(self.collectedFilesCache.size).toBe(1);
  });

  it('decodes base64-encoded CDP response bodies', async () => {
    const source = 'const decoded = true;';
    const { self } = createHarness({
      responseBodies: {
        'req-1': {
          body: Buffer.from(source, 'utf-8').toString('base64'),
          base64Encoded: true,
        },
      },
      gotoResponses: [
        {
          response: { url: 'https://site/base64.js', mimeType: 'application/javascript' },
          requestId: 'req-1',
          type: 'Script',
        },
      ],
    });

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.content).toBe(source);
  });

  it('truncates oversized external files and preserves truncation metadata', async () => {
    const content = 'x'.repeat(32);
    const { self } = createHarness({
      responseBodies: {
        'req-1': {
          body: content,
          base64Encoded: false,
        },
      },
      gotoResponses: [
        {
          response: { url: 'https://site/large.js', mimeType: 'application/javascript' },
          requestId: 'req-1',
          type: 'Script',
        },
      ],
    });
    self.MAX_SINGLE_FILE_SIZE = 8;

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.content).toBe('x'.repeat(8));
    expect(result.files[0]?.metadata).toMatchObject({
      truncated: true,
      originalSize: content.length,
      truncatedSize: 8,
    });
  });

  it('returns analyzed dependencies and writes them to cache on cache miss', async () => {
    const dependencyGraph = {
      nodes: [{ id: 'https://site/app.js', url: 'https://site/app.js', type: 'external' }],
      edges: [{ from: 'https://site/app.js', to: 'https://site/dep.js', type: 'import' as const }],
    };
    collectorHelpers.analyzeDependencies.mockReturnValue(dependencyGraph);

    const { self } = createHarness({
      cacheEnabled: true,
    });

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
    });

    expect(result.dependencies).toEqual(dependencyGraph);
    expect(self.cache.set).toHaveBeenCalledTimes(1);
    expect(self.cache.set.mock.calls[0]?.[0]).toBe('https://site');
    expect(self.cache.set.mock.calls[0]?.[1]).toMatchObject({
      dependencies: dependencyGraph,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(self.cache.set.mock.calls[0]?.[1]?.summaries).toBeUndefined();
    expect(self.cache.set.mock.calls[0]?.[2]).toMatchObject({ url: 'https://site' });
  });

  it('recomputes totalSize from processed files after smart collection', async () => {
    const { self } = createHarness();
    self.smartCollector.smartCollect = vi.fn().mockResolvedValue([
      {
        url: 'https://site/app.js',
        content: 'tiny',
        size: 4,
        type: 'external',
      },
    ]);

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      smartMode: 'priority',
    });

    expect(result.files).toHaveLength(1);
    expect(result.totalSize).toBe(4);
  });

  it('adds compression metadata when compress=true', async () => {
    const { self } = createHarness({
      gotoResponses: [
        {
          response: { url: 'https://site/app.js', mimeType: 'application/javascript' },
          requestId: 'req-1',
          type: 'Script',
        },
      ],
    });
    self.compressor.shouldCompress = vi.fn().mockReturnValue(true);
    self.compressor.compressBatch = vi.fn().mockResolvedValue([
      {
        url: 'https://site/app.js',
        originalSize: 20,
        compressedSize: 10,
        compressionRatio: 50,
      },
    ]);
    self.compressor.getStats = vi.fn().mockReturnValue({
      totalOriginalSize: 20,
      totalCompressedSize: 10,
      averageRatio: 50,
      cacheHits: 0,
      cacheMisses: 1,
    });

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      compress: true,
    });

    expect(self.compressor.compressBatch).toHaveBeenCalledTimes(1);
    expect(result.files[0]?.metadata).toMatchObject({
      compressed: true,
      originalSize: 20,
      compressedSize: 10,
      compressionRatio: 50,
    });
  });

  it('returns summaries immediately for smartMode=summary', async () => {
    const { self } = createHarness();
    const summaries = [
      {
        url: 'https://site/app.js',
        size: 10,
        type: 'external',
        hasEncryption: false,
        hasAPI: true,
        hasObfuscation: false,
        functions: ['run'],
        imports: ['./dep'],
        preview: 'preview',
      },
    ];
    self.smartCollector.smartCollect = vi.fn().mockResolvedValue(summaries);

    const result = await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      smartMode: 'summary',
    });

    expect(result.files).toEqual([]);
    expect(result.summaries).toEqual(summaries);
    expect(result.dependencies).toEqual({ nodes: [], edges: [] });
    expect(result.totalSize).toBe(0);
    expect(self.cache.set).not.toHaveBeenCalled();
  });

  it('rejects invalid collector contexts that do not provide shouldCollectUrl', async () => {
    await expect(
      collectInnerImpl(
        {
          init: vi.fn(),
          applyAntiDetection: vi.fn(),
        },
        { url: 'https://site' }
      )
    ).rejects.toThrow('Invalid collector context');
  });
});
