import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectInlineScriptsMock = vi.hoisted(() => vi.fn());
const collectServiceWorkersMock = vi.hoisted(() => vi.fn());
const collectWebWorkersMock = vi.hoisted(() => vi.fn());
const analyzeDependenciesMock = vi.hoisted(() => vi.fn());
const setupWebWorkerTrackingMock = vi.hoisted(() => vi.fn());

vi.mock('@src/modules/collector/PageScriptCollectors', () => ({
  collectInlineScripts: collectInlineScriptsMock,
  collectServiceWorkers: collectServiceWorkersMock,
  collectWebWorkers: collectWebWorkersMock,
  analyzeDependencies: analyzeDependenciesMock,
  setupWebWorkerTracking: setupWebWorkerTrackingMock,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { collectInnerImpl } from '@modules/collector/CodeCollectorCollectInternal';

type ResponseListener = (params: unknown) => Promise<void> | void;

interface HarnessOptions {
  responseBodies?: Record<string, { body: string; base64Encoded?: boolean }>;
  gotoResponses?: Array<{
    response: { url: string; mimeType?: string };
    requestId: string;
    type?: string;
  }>;
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
      if (responseListener) {
        for (const response of gotoResponses) {
          await responseListener(response);
        }
      }
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const self = {
    cacheEnabled: options.cacheEnabled ?? false,
    cache: {
      get: vi.fn().mockResolvedValue(options.cachedResult ?? null),
      set: vi.fn(),
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
      smartCollect: vi.fn(),
    },
    compressor: {
      shouldCompress: vi.fn(),
      compressBatch: vi.fn(),
      getStats: vi.fn(),
    },
  };

  return { cdpSession, page, self };
}

describe('collectInnerImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectInlineScriptsMock.mockResolvedValue([]);
    collectServiceWorkersMock.mockResolvedValue([]);
    collectWebWorkersMock.mockResolvedValue([]);
    analyzeDependenciesMock.mockImplementation((files: Array<{ url: string }>) => ({
      nodes: files.map((file) => ({ id: file.url, url: file.url, type: 'external' })),
      edges: [],
    }));
    setupWebWorkerTrackingMock.mockResolvedValue(undefined);
  });

  it('preserves web worker setup before navigation', async () => {
    const { page, self } = createHarness();

    await collectInnerImpl(self, {
      url: 'https://site',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: true,
    });

    expect(setupWebWorkerTrackingMock).toHaveBeenCalledWith(page);
    expect(setupWebWorkerTrackingMock.mock.invocationCallOrder[0]).toBeLessThan(
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
    collectWebWorkersMock.mockResolvedValue([
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

    expect(setupWebWorkerTrackingMock).not.toHaveBeenCalled();
    expect(collectWebWorkersMock).not.toHaveBeenCalled();
  });

  it('applies filterRules and global file cap across all collector sources', async () => {
    const { self } = createHarness();
    self.MAX_FILES_PER_COLLECT = 2;
    collectInlineScriptsMock.mockResolvedValue([
      { url: 'inline-script-0', content: 'a', size: 1, type: 'inline' },
      { url: 'inline-script-1', content: 'b', size: 1, type: 'inline' },
    ]);
    collectServiceWorkersMock.mockResolvedValue([
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
    collectWebWorkersMock.mockResolvedValue([
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

  it('short-circuits collection when cache returns a hit', async () => {
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

  it('returns analyzed dependencies and writes them to cache on cache miss', async () => {
    const dependencyGraph = {
      nodes: [{ id: 'https://site/app.js', url: 'https://site/app.js', type: 'external' }],
      edges: [{ from: 'https://site/app.js', to: 'https://site/dep.js', type: 'import' as const }],
    };
    analyzeDependenciesMock.mockReturnValue(dependencyGraph);

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
