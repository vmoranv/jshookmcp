import { describe, it, expect, beforeEach, vi } from 'vitest';
import { V8InspectorHandlers } from '@server/domains/v8-inspector/index';
import { V8InspectorClient } from '@modules/v8-inspector/V8InspectorClient';
import type { MCPServerContext } from '@server/MCPServer.context';

describe('v8_wasm_inspect', () => {
  let handlers: V8InspectorHandlers;
  let mockCtx: MCPServerContext;
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      createCDPSession: vi.fn(),
    };
    mockCtx = {
      eventBus: { emit: vi.fn() },
      pageController: {
        getActivePage: vi.fn().mockResolvedValue(mockPage),
        getPage: vi.fn().mockResolvedValue(mockPage),
      },
    } as unknown as MCPServerContext;
    const client = new V8InspectorClient(undefined);
    handlers = new V8InspectorHandlers({ ctx: mockCtx, client });
  });

  describe('tool definition', () => {
    it('registers v8_wasm_inspect in definitions', async () => {
      const { v8InspectorTools } = await import('@server/domains/v8-inspector/definitions');
      const def = v8InspectorTools.find((t) => t.name === 'v8_wasm_inspect');
      expect(def).toBeDefined();
      expect(def!.name).toBe('v8_wasm_inspect');
    });

    it('has a description mentioning WASM GC', async () => {
      const { v8InspectorTools } = await import('@server/domains/v8-inspector/definitions');
      const def = v8InspectorTools.find((t) => t.name === 'v8_wasm_inspect');
      expect(def!.description).toMatch(/WASM/i);
    });
  });

  describe('input validation', () => {
    it('accepts empty args (discovery mode)', async () => {
      const mockSession = {
        send: vi.fn().mockResolvedValue({
          result: {
            value: JSON.stringify({
              modules: [],
              totalModules: 0,
              gcModules: 0,
              hasGC: false,
              features: {},
              structs: [],
            }),
          },
        }),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mockPage.createCDPSession.mockResolvedValue(mockSession);

      const result = await handlers.handle('v8_wasm_inspect', {});
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('wasmGcAvailable', false);
    });

    it('accepts scriptId filter', async () => {
      const mockSession = {
        send: vi.fn().mockResolvedValue({
          result: {
            value: JSON.stringify({
              modules: [],
              totalModules: 0,
              gcModules: 0,
              hasGC: false,
              features: {},
              structs: [],
            }),
          },
        }),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mockPage.createCDPSession.mockResolvedValue(mockSession);

      const result = await handlers.handle('v8_wasm_inspect', { scriptId: 'wasm://123' });
      expect(result).toHaveProperty('success', true);
    });

    it('accepts includeStructs=false to skip struct enumeration', async () => {
      const mockSession = {
        send: vi.fn().mockResolvedValue({
          result: {
            value: JSON.stringify({
              modules: [],
              totalModules: 0,
              gcModules: 0,
              hasGC: true,
              features: { gc: true },
              structs: [],
            }),
          },
        }),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mockPage.createCDPSession.mockResolvedValue(mockSession);

      const result = await handlers.handle('v8_wasm_inspect', { includeStructs: false });
      expect(result).toHaveProperty('success', true);
      const r = result as any;
      expect(r.structs).toBeUndefined();
    });
  });

  describe('WASM GC available', () => {
    it('reports wasmGcAvailable=true when Struct API exists', async () => {
      const mockSession = {
        send: vi.fn().mockResolvedValue({
          result: {
            value: JSON.stringify({
              modules: [],
              totalModules: 3,
              gcModules: 3,
              hasGC: true,
              features: { gc: true, threads: false, simd: true },
              structs: [],
            }),
          },
        }),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mockPage.createCDPSession.mockResolvedValue(mockSession);

      const result = await handlers.handle('v8_wasm_inspect', {});
      const r = result as any;
      expect(r.wasmGcAvailable).toBe(true);
      expect(r.summary.hasGcFeature).toBe(true);
      expect(r.summary.hasThreadsFeature).toBe(false);
      expect(r.summary.hasSimdFeature).toBe(true);
    });

    it('reports gcModules=0 when GC unavailable', async () => {
      const mockSession = {
        send: vi.fn().mockResolvedValue({
          result: {
            value: JSON.stringify({
              modules: [],
              totalModules: 0,
              gcModules: 0,
              hasGC: false,
              features: { gc: false, threads: false, simd: false },
              structs: [],
            }),
          },
        }),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mockPage.createCDPSession.mockResolvedValue(mockSession);

      const result = await handlers.handle('v8_wasm_inspect', {});
      const r = result as any;
      expect(r.wasmGcAvailable).toBe(false);
      expect(r.summary.gcModules).toBe(0);
      expect(r.summary.nonGcModules).toBe(0);
    });
  });

  describe('graceful degradation', () => {
    it('returns empty result when pageController missing', async () => {
      mockCtx.pageController = undefined;
      const result = await handlers.handle('v8_wasm_inspect', {});
      const r = result as any;
      expect(r.wasmGcAvailable).toBe(false);
      expect(r.totalModules).toBe(0);
    });
  });
});
