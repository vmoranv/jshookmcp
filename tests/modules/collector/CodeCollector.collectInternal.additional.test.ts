import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeFile, DependencyGraph, CollectCodeOptions } from '@internal-types/index';
import type { DeepPartial } from '../../server/domains/shared/mock-factories';

type ResponseHandler = (payload: unknown) => void | Promise<void>;
type CompressionResult = {
  url: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
};

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const collectorHelpers = vi.hoisted(() => ({
  collectInlineScripts: vi.fn(async (): Promise<CodeFile[]> => []),
  collectServiceWorkers: vi.fn(async (): Promise<CodeFile[]> => []),
  collectWebWorkers: vi.fn(async (): Promise<CodeFile[]> => []),
  analyzeDependencies: vi.fn((): DependencyGraph => ({ nodes: [], edges: [] })),
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

function createPageAndSession() {
  const listeners = new Map<string, Set<ResponseHandler>>();
  const session = {
    send: vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({})),
    on: vi.fn((event: string, handler: ResponseHandler) => {
      const group = listeners.get(event) ?? new Set<ResponseHandler>();
      group.add(handler);
      listeners.set(event, group);
    }),
    off: vi.fn((event: string, handler: ResponseHandler) => {
      listeners.get(event)?.delete(handler);
    }),
    detach: vi.fn(async () => {}),
    _listeners: listeners,
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

function createBaseContext(page: unknown) {
  return {
    cacheEnabled: false,
    cache: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
    },
    init: vi.fn(async () => {}),
    browser: { newPage: vi.fn(async () => page) },
    config: { timeout: 5000 } as { timeout?: number },
    userAgent: 'test-ua',
    applyAntiDetection: vi.fn(async () => {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    cdpSession: null as any,
    cdpListeners: {} as { responseReceived?: ResponseHandler },
    MAX_FILES_PER_COLLECT: 50,
    MAX_SINGLE_FILE_SIZE: 1024,
    collectedUrls: new Set<string>(),
    cleanupCollectedUrls: vi.fn(),
    shouldCollectUrl: vi.fn(() => true),
    collectedFilesCache: new Map<string, CodeFile>(),
    smartCollector: {
      smartCollect: vi.fn(async (_page: unknown, files: CodeFile[]) => files),
    },
    compressor: {
      shouldCompress: vi.fn(() => false),
      compressBatch: vi.fn(async (): Promise<CompressionResult[]> => []),
      getStats: vi.fn(() => ({
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        averageRatio: 0,
        cacheHits: 0,
        cacheMisses: 0,
      })),
    },
  };
}

describe('CodeCollector collectInternal additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertCollectorInternals validation', () => {
    it('throws for non-object context', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await expect(collectInnerImpl(null, { url: 'https://example.com' } as DeepPartial<any>)).rejects.toThrow(
        'Invalid collector context'
      );
    });

    it('throws for context missing required functions', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        collectInnerImpl({ init: vi.fn() }, { url: 'https://example.com' } as DeepPartial<any>)
      ).rejects.toThrow('Invalid collector context');
    });

    it('throws when init is not a function', async () => {
      await expect(
        collectInnerImpl({ init: 'not-a-function', applyAntiDetection: vi.fn() }, {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>)
      ).rejects.toThrow('Invalid collector context');
    });
  });

  describe('cache bypass when disabled', () => {
    it('skips cache lookup when cacheEnabled is false', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.cacheEnabled = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await collectInnerImpl(ctx as DeepPartial<any>, { url: 'https://example.com' } as CollectCodeOptions);

      expect(ctx.cache.get).not.toHaveBeenCalled();
    });

    it('calls cache.get when cacheEnabled is true and no hit', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.cacheEnabled = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await collectInnerImpl(ctx as DeepPartial<any>, { url: 'https://example.com' } as CollectCodeOptions);

      expect(ctx.cache.get).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    });
  });

  describe('timeout handling', () => {
    it('uses options.timeout when provided', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          timeout: 10000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(page.setDefaultTimeout).toHaveBeenCalledWith(10000);
    });

    it('uses config.timeout when options.timeout is not provided', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.config.timeout = 8000;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await collectInnerImpl(ctx as DeepPartial<any>, { url: 'https://example.com' } as CollectCodeOptions);

      expect(page.setDefaultTimeout).toHaveBeenCalledWith(8000);
    });

    it('defaults to 30000 when neither options nor config timeout is set', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.config = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await collectInnerImpl(ctx as DeepPartial<any>, { url: 'https://example.com' } as CollectCodeOptions);

      expect(page.setDefaultTimeout).toHaveBeenCalledWith(30000);
    });
  });

  describe('CDP responseReceived handler', () => {
    it('ignores non-CDP-shaped params', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);

      // Override goto to fire the responseReceived listener with bad data
      page.goto = vi.fn(async () => {
        const handlers = session._listeners.get('Network.responseReceived');
        if (handlers) {
          for (const handler of handlers) {
            // Not a valid CDP response
            await handler({ something: 'else' });
            // Missing requestId
            await handler({ response: { url: 'http://example.com' } });
          }
        }
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(result.files).toHaveLength(0);
    });

    it('collects JavaScript files from CDP events', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);

      session.send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === 'Network.getResponseBody') {
          return { body: 'console.log("hello")', base64Encoded: false };
        }
        return {};
      });

      page.goto = vi.fn(async () => {
        const handlers = session._listeners.get('Network.responseReceived');
        if (handlers) {
          for (const handler of handlers) {
            await handler({
              response: {
                url: 'https://example.com/script.js',
                mimeType: 'application/javascript',
              },
              requestId: 'req1',
              type: 'Script',
            });
          }
        }
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      const externalFiles = result.files.filter((f: unknown) => f.type === 'external');
      expect(externalFiles.length).toBeGreaterThanOrEqual(1);
      const firstExternalFile = externalFiles[0];
      expect(firstExternalFile).toBeDefined();
      expect(firstExternalFile?.url).toBe('https://example.com/script.js');
      expect(firstExternalFile?.content).toBe('console.log("hello")');
    });

    it('decodes base64 response bodies', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);
      const originalContent = 'var x = 42;';
      const base64Content = Buffer.from(originalContent).toString('base64');

      session.send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === 'Network.getResponseBody') {
          return { body: base64Content, base64Encoded: true };
        }
        return {};
      });

      page.goto = vi.fn(async () => {
        const handlers = session._listeners.get('Network.responseReceived');
        if (handlers) {
          for (const handler of handlers) {
            await handler({
              response: { url: 'https://example.com/encoded.js', mimeType: 'text/javascript' },
              requestId: 'req2',
              type: 'Script',
            });
          }
        }
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      const file = result.files.find((f: unknown) => f.url === 'https://example.com/encoded.js');
      expect(file).toBeDefined();
      expect(file!.content).toBe(originalContent);
    });

    it('truncates files exceeding MAX_SINGLE_FILE_SIZE', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.MAX_SINGLE_FILE_SIZE = 10;

      const largeContent = 'a'.repeat(100);
      session.send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === 'Network.getResponseBody') {
          return { body: largeContent, base64Encoded: false };
        }
        return {};
      });

      page.goto = vi.fn(async () => {
        const handlers = session._listeners.get('Network.responseReceived');
        if (handlers) {
          for (const handler of handlers) {
            await handler({
              response: { url: 'https://example.com/large.js' },
              requestId: 'req3',
              type: 'Script',
            });
          }
        }
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      const file = result.files.find((f: unknown) => f.url === 'https://example.com/large.js');
      expect(file).toBeDefined();
      expect(file!.content.length).toBe(10);
      expect(file!.metadata?.truncated).toBe(true);
      expect(file!.metadata?.originalSize).toBe(100);
    });

    it('stops collecting after MAX_FILES_PER_COLLECT is reached', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.MAX_FILES_PER_COLLECT = 2;

      session.send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === 'Network.getResponseBody') {
          return { body: 'code', base64Encoded: false };
        }
        return {};
      });

      page.goto = vi.fn(async () => {
        const handlers = session._listeners.get('Network.responseReceived');
        if (handlers) {
          for (const handler of handlers) {
            for (let i = 0; i < 5; i++) {
              await handler({
                response: { url: `https://example.com/script${i}.js` },
                requestId: `req-${i}`,
                type: 'Script',
              });
            }
          }
        }
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      const externalFiles = result.files.filter((f: unknown) => f.type === 'external');
      expect(externalFiles.length).toBe(2);
    });

    it('skips duplicate URLs', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);

      session.send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === 'Network.getResponseBody') {
          return { body: 'code', base64Encoded: false };
        }
        return {};
      });

      page.goto = vi.fn(async () => {
        const handlers = session._listeners.get('Network.responseReceived');
        if (handlers) {
          for (const handler of handlers) {
            // Same URL twice
            await handler({
              response: { url: 'https://example.com/dup.js' },
              requestId: 'req-a',
              type: 'Script',
            });
            await handler({
              response: { url: 'https://example.com/dup.js' },
              requestId: 'req-b',
              type: 'Script',
            });
          }
        }
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      const dupFiles = result.files.filter((f: unknown) => f.url === 'https://example.com/dup.js');
      expect(dupFiles.length).toBe(1);
    });

    it('handles getResponseBody failure gracefully', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);

      session.send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === 'Network.getResponseBody') {
          throw new Error('Response body not available');
        }
        return {};
      });

      page.goto = vi.fn(async () => {
        const handlers = session._listeners.get('Network.responseReceived');
        if (handlers) {
          for (const handler of handlers) {
            await handler({
              response: { url: 'https://example.com/fail.js' },
              requestId: 'req-fail',
              type: 'Script',
            });
          }
        }
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(result.files.filter((f: unknown) => f.url === 'https://example.com/fail.js')).toHaveLength(
        0
      );
      expect(loggerState.warn).toHaveBeenCalled();
    });

    it('skips responses with non-string body', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);

      session.send = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === 'Network.getResponseBody') {
          return { body: null, base64Encoded: false };
        }
        return {};
      });

      page.goto = vi.fn(async () => {
        const handlers = session._listeners.get('Network.responseReceived');
        if (handlers) {
          for (const handler of handlers) {
            await handler({
              response: { url: 'https://example.com/null-body.js' },
              requestId: 'req-null',
              type: 'Script',
            });
          }
        }
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(
        result.files.filter((f: unknown) => f.url === 'https://example.com/null-body.js')
      ).toHaveLength(0);
    });
  });

  describe('inline, service worker, and web worker collection flags', () => {
    it('skips inline scripts when includeInline is false', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      collectorHelpers.collectInlineScripts.mockResolvedValue([
        { url: 'inline://1', content: 'code', size: 4, type: 'inline' },
      ]);

      await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          includeInline: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(collectorHelpers.collectInlineScripts).not.toHaveBeenCalled();
    });

    it('skips service workers when includeServiceWorker is false', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          includeServiceWorker: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(collectorHelpers.collectServiceWorkers).not.toHaveBeenCalled();
    });

    it('skips web workers when includeWebWorker is false', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          includeWebWorker: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(collectorHelpers.collectWebWorkers).not.toHaveBeenCalled();
    });

    it('includes all worker types by default', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await collectInnerImpl(ctx as DeepPartial<any>, { url: 'https://example.com' } as CollectCodeOptions);

      expect(collectorHelpers.collectInlineScripts).toHaveBeenCalled();
      expect(collectorHelpers.collectServiceWorkers).toHaveBeenCalled();
      expect(collectorHelpers.collectWebWorkers).toHaveBeenCalled();
    });
  });

  describe('smart collection modes', () => {
    it('uses smart collector in non-summary mode and returns processed files', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      const smartFiles: CodeFile[] = [
        { url: 'https://example.com/smart.js', content: 'optimized', size: 9, type: 'external' },
      ];
      ctx.smartCollector.smartCollect = vi.fn(
        async (_page: unknown, _files: CodeFile[]) => smartFiles
      );

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          smartMode: 'priority',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(ctx.smartCollector.smartCollect).toHaveBeenCalled();
      expect(result.files).toEqual(smartFiles);
    });

    it('falls back to original files when smart collection fails', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      ctx.smartCollector.smartCollect = vi.fn(async () => {
        throw new Error('Smart collect error');
      });

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          smartMode: 'priority',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(loggerState.error).toHaveBeenCalled();
      expect(result.files).toBeDefined();
    });

    it('falls back when smart collection returns unexpected type', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      // Return objects that are neither CodeFile nor CodeSummary
      ctx.smartCollector.smartCollect = vi.fn(async (_page: unknown, _files: CodeFile[]) => [
        { notACodeFile: true },
      ]) as unknown as typeof ctx.smartCollector.smartCollect;

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          smartMode: 'priority',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(result.files).toBeDefined();
    });

    it('does not apply smart collection when smartMode is full', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          smartMode: 'full',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(ctx.smartCollector.smartCollect).not.toHaveBeenCalled();
    });
  });

  describe('compression', () => {
    it('applies compression when compress is true and files need compression', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.compressor.shouldCompress = vi.fn(() => true);
      ctx.compressor.compressBatch = vi.fn(async () => [
        {
          url: 'https://example.com/inline',
          originalSize: 100,
          compressedSize: 50,
          compressionRatio: 0.5,
        },
      ]);
      ctx.compressor.getStats = vi.fn(() => ({
        totalOriginalSize: 100,
        totalCompressedSize: 50,
        averageRatio: 50,
        cacheHits: 1,
        cacheMisses: 0,
      }));

      collectorHelpers.collectInlineScripts.mockResolvedValue([
        { url: 'https://example.com/inline', content: 'a'.repeat(100), size: 100, type: 'inline' },
      ]);

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          compress: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(ctx.compressor.compressBatch).toHaveBeenCalled();
      const compressed = result.files.find((f: unknown) => f.url === 'https://example.com/inline');
      expect(compressed?.metadata?.compressed).toBe(true);
    });

    it('skips compression when no files need it', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.compressor.shouldCompress = vi.fn(() => false);

      await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          compress: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(ctx.compressor.compressBatch).not.toHaveBeenCalled();
    });

    it('handles compression failure gracefully', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.compressor.shouldCompress = vi.fn(() => true);
      ctx.compressor.compressBatch = vi.fn(async () => {
        throw new Error('Compression failed');
      });

      collectorHelpers.collectInlineScripts.mockResolvedValue([
        { url: 'https://example.com/inline', content: 'code', size: 4, type: 'inline' },
      ]);

      const result = await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          compress: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      expect(loggerState.error).toHaveBeenCalled();
      expect(result.files).toBeDefined();
    });
  });

  describe('result caching on output', () => {
    it('saves result to cache after collection when cacheEnabled is true', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);
      ctx.cacheEnabled = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await collectInnerImpl(ctx as DeepPartial<any>, { url: 'https://example.com' } as CollectCodeOptions);

      expect(ctx.cache.set).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          files: expect.any(Array),
          dependencies: expect.any(Object),
          totalSize: expect.any(Number),
          collectTime: expect.any(Number),
        }),
        expect.any(Object)
      );
    });
  });

  describe('cleanup in finally block', () => {
    it('closes page even when goto throws', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      page.goto = vi.fn(async () => {
        throw new Error('Navigation failed');
      });

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        collectInnerImpl(ctx as DeepPartial<any>, { url: 'https://example.com' } as DeepPartial<any>)
      ).rejects.toThrow('Navigation failed');

      expect(page.close).toHaveBeenCalled();
    });

    it('handles cdpSession detach failure in finally block', async () => {
      const { page, session } = createPageAndSession();
      const ctx = createBaseContext(page);

      session.detach = vi.fn(async () => {
        throw new Error('Already detached');
      });

      // Force an error after cdpSession is set but before it's cleaned up in the main try
      page.goto = vi.fn(async () => {
        throw new Error('Nav error');
      });

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        collectInnerImpl(ctx as DeepPartial<any>, { url: 'https://example.com' } as DeepPartial<any>)
      ).rejects.toThrow('Nav error');

      // page.close should still be called even if detach fails
      expect(page.close).toHaveBeenCalled();
    });
  });

  describe('dynamic script waiting', () => {
    it('waits for dynamic scripts when includeDynamic is true', async () => {
      const { page } = createPageAndSession();
      const ctx = createBaseContext(page);

      const startTime = Date.now();

      await collectInnerImpl(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ctx as DeepPartial<any>,
        {
          url: 'https://example.com',
          includeDynamic: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        } as DeepPartial<any>
      );

      const elapsed = Date.now() - startTime;
      // Should have waited at least some time (the 3000ms delay)
      expect(elapsed).toBeGreaterThanOrEqual(2500);
    });
  });
});
