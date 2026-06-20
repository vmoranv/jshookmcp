import { describe, it, expect, vi } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

/**
 * Build a mock page whose `evaluate` returns `allocations` for the hook-state
 * query (detected via the `webgpuHookState` substring in the function body),
 * and whose CDP session reports the given metrics.
 */
function makeMockPage(allocations: any[], metrics: any[] = []) {
  return {
    url: () => 'https://example.com/',
    evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
      if (typeof fn === 'function' && String(fn).includes('webgpuHookState')) {
        return allocations;
      }
      return undefined;
    }),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ metrics }),
      detach: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeHandlers(page: any): WebGPUHandlers {
  const ctx = {
    eventBus: { emit: () => {} },
    pageController: { getActivePage: async () => page },
  } as unknown as MCPServerContext;
  return new WebGPUHandlers(ctx);
}

describe('webgpu_memory_layout', () => {
  it('should require active page', async () => {
    const ctx = {
      eventBus: { emit: () => {} },
      pageController: {
        getActivePage: async () => {
          throw new Error('No active page');
        },
      },
    } as unknown as MCPServerContext;
    const handlers = new WebGPUHandlers(ctx);

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should return live GPU memory allocations with memorySource and trackedBytes', async () => {
    const allocations = [
      { size: 1024, usage: 'VERTEX | COPY_DST', label: 'vbuf', type: 'buffer', alive: true },
      { size: 4096, usage: 'UNIFORM', type: 'buffer', alive: true },
    ];
    // No GPUMemoryUsedKB metric → memorySource should be 'tracked'.
    const handlers = makeHandlers(makeMockPage(allocations, []));

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('heapSize');
    expect(result).toHaveProperty('usedHeapSize');
    expect(result).toHaveProperty('allocations');
    expect(result.allocations).toBeInstanceOf(Array);
    expect(result.allocations.length).toBe(2);

    // New fields: memorySource + trackedBytes.
    expect(result.memorySource).toBe('tracked');
    expect(result.trackedBytes).toBe(1024 + 4096);
    // In tracked mode usedHeapSize == trackedBytes (lower bound).
    expect(result.usedHeapSize).toBe(result.trackedBytes);
    expect(result.heapSize).toBeGreaterThan(0);

    const aliveAllocations = result.allocations.filter((a: any) => a.alive);
    expect(aliveAllocations.length).toBe(2);
  });

  it('should report memorySource=cdp when GPUMemoryUsedKB is available', async () => {
    const allocations = [{ size: 2048, usage: 'INDEX', type: 'buffer', alive: true }];
    const handlers = makeHandlers(
      makeMockPage(allocations, [{ name: 'GPUMemoryUsedKB', value: 512 }]),
    );

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.memorySource).toBe('cdp');
    // 512 KB → 524288 bytes.
    expect(result.usedHeapSize).toBe(512 * 1024);
    // trackedBytes is still computed from allocations.
    expect(result.trackedBytes).toBe(2048);
  });

  it('should report memorySource=estimated when no allocations and no CDP metric', async () => {
    const handlers = makeHandlers(makeMockPage([], []));

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.memorySource).toBe('estimated');
    expect(result.usedHeapSize).toBe(0);
    expect(result.trackedBytes).toBe(0);
    expect(result.heapSize).toBeGreaterThan(0);
  });

  it('should track buffer usage flags', async () => {
    const allocations = [
      { size: 1024, usage: 'VERTEX | COPY_DST', type: 'buffer', alive: true },
      { size: 2048, usage: 'INDEX', type: 'buffer', alive: true },
    ];
    const handlers = makeHandlers(makeMockPage(allocations, []));

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.allocations.some((a: any) => a.usage.includes('VERTEX'))).toBe(true);
  });
});
