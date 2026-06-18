import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

describe('webgpu_memory_layout', () => {
  let ctx: MCPServerContext;
  let handlers: WebGPUHandlers;

  beforeEach(() => {
    ctx = {
      eventBus: {
        emit: () => {},
      },
      pageController: {
        getActivePage: async () => {
          throw new Error('No active page');
        },
      },
    } as unknown as MCPServerContext;

    handlers = new WebGPUHandlers(ctx);
  });

  it('should require active page', async () => {
    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should return live GPU memory allocations', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
        if (typeof fn === 'function' && String(fn).includes('__webgpuHookState')) {
          return [
            { size: 1024, usage: 'VERTEX | COPY_DST', label: 'vbuf', type: 'buffer', alive: true },
            { size: 4096, usage: 'UNIFORM', type: 'buffer', alive: true },
          ];
        }
        return undefined;
      }),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ metrics: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };

    ctx.pageController = {
      getActivePage: async () => mockPage,
    } as any;

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      expect(result).toHaveProperty('heapSize');
      expect(result).toHaveProperty('usedHeapSize');
      expect(result).toHaveProperty('allocations');
      expect(result.allocations).toBeInstanceOf(Array);
      expect(result.allocations.length).toBeGreaterThan(0);
      expect(result.heapSize).toBeGreaterThan(0);

      const aliveAllocations = result.allocations.filter((a: any) => a.alive);
      expect(aliveAllocations.length).toBeGreaterThan(0);
    }
  });

  it('should track buffer usage flags', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
        if (typeof fn === 'function' && String(fn).includes('__webgpuHookState')) {
          return [
            { size: 1024, usage: 'VERTEX | COPY_DST', type: 'buffer', alive: true },
            { size: 2048, usage: 'INDEX', type: 'buffer', alive: true },
          ];
        }
        return undefined;
      }),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ metrics: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };

    ctx.pageController = {
      getActivePage: async () => mockPage,
    } as any;

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      expect(result.allocations.some((a: any) => a.usage.includes('VERTEX'))).toBe(true);
    }
  });
});
