import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const collectorHelpers = vi.hoisted(() => ({
  collectInlineScripts: vi.fn(async () => []),
  collectServiceWorkers: vi.fn(async () => []),
  collectWebWorkers: vi.fn(async () => []),
  analyzeDependencies: vi.fn(() => ({ nodes: [], edges: [] })),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@modules/collector/PageScriptCollectors', () => ({
  collectInlineScripts: collectorHelpers.collectInlineScripts,
  collectServiceWorkers: collectorHelpers.collectServiceWorkers,
  collectWebWorkers: collectorHelpers.collectWebWorkers,
  analyzeDependencies: collectorHelpers.analyzeDependencies,
}));

import { collectInnerImpl } from '@modules/collector/CodeCollectorCollectInternal';

function createPageAndSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  const session = {
    send: vi.fn(async () => ({})),
    on: vi.fn((event: string, handler: (payload: any) => void) => {
      const group = listeners.get(event) ?? new Set<(payload: any) => void>();
      group.add(handler);
      listeners.set(event, group);
    }),
    off: vi.fn((event: string, handler: (payload: any) => void) => {
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

describe('CodeCollector collect internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached results before initializing the browser flow', async () => {
    const cached = {
      files: [{ url: 'https://example.com/app.js', content: 'code', size: 4, type: 'external' }],
      dependencies: { nodes: [], edges: [] },
      totalSize: 4,
      collectTime: 1,
    };
    const ctx = {
      cacheEnabled: true,
      cache: {
        get: vi.fn(async () => cached),
        set: vi.fn(async () => {}),
      },
      init: vi.fn(async () => {}),
      browser: null,
      config: {},
      userAgent: 'ua',
      applyAntiDetection: vi.fn(async () => {}),
    };

    const result = await collectInnerImpl(ctx as any, {
      url: 'https://example.com',
    } as any);

    expect(result).toBe(cached);
    expect(ctx.init).not.toHaveBeenCalled();
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
    };

    await expect(
      collectInnerImpl(ctx as any, {
        url: 'https://example.com',
      } as any),
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

    const result = await collectInnerImpl(ctx as any, {
      url: 'https://example.com',
      smartMode: 'summary',
    } as any);

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
});
