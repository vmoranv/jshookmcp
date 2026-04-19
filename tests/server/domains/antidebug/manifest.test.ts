import { describe, expect, it, vi } from 'vitest';
import type { CodeCollector } from '@server/domains/shared/modules';
import type { AntiDebugToolHandlers } from '@server/domains/antidebug/handlers';
import type { MCPServerContext } from '@server/domains/shared/registry';

// Mock registry so bind bypasses real dependency resolution and returns the lambda
vi.mock('@server/domains/shared/registry', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    bindByDepKey: (_key: string, fn: any) => fn,
  };
});

// Import after mocks
import manifest from '@server/domains/antidebug/manifest';

describe('Antidebug Manifest', () => {
  describe('ensure', () => {
    it('initializes context components if missing', () => {
      const registerCachesMock = vi.fn();
      const mockCtx: any = {
        config: { puppeteer: {} },
        registerCaches: registerCachesMock,
      };

      const handler = manifest.ensure(mockCtx as MCPServerContext);

      expect(mockCtx.collector).toBeDefined();
      expect(registerCachesMock).toHaveBeenCalled();
      expect(mockCtx.antidebugHandlers).toBeDefined();
      expect(handler).toBe(mockCtx.antidebugHandlers);
    });

    it('returns existing handlers if already initialized', () => {
      const existingHandler = {} as AntiDebugToolHandlers;
      const existingCollector = {} as CodeCollector;
      const mockCtx: any = {
        collector: existingCollector,
        antidebugHandlers: existingHandler,
      };

      const handler = manifest.ensure(mockCtx as MCPServerContext);

      expect(handler).toBe(existingHandler);
    });
  });

  describe('registrations', () => {
    it('binds correctly to handler methods', async () => {
      const mockHandler = {
        handleAntidebugBypass: vi.fn(),
        handleAntiDebugDetectProtections: vi.fn(),
      } as unknown as AntiDebugToolHandlers;

      const args = { foo: 'bar' };

      // Since we mocked bindByDepKey to return the raw lambda (h, a) => h.method(a)
      // we can assert that calling each bind function routes to the correct method.
      for (const reg of manifest.registrations) {
        const fn = reg.bind as unknown as (h: AntiDebugToolHandlers, a: any) => unknown;
        await fn(mockHandler, args);
      }

      expect(mockHandler.handleAntidebugBypass).toHaveBeenCalledWith(args);
      expect(mockHandler.handleAntiDebugDetectProtections).toHaveBeenCalledWith(args);
    });
  });
});
