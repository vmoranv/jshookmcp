import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

function makeHandlers(page: any): WebGPUHandlers {
  const ctx = {
    eventBus: { emit: () => {} },
    pageController: { getActivePage: async () => page },
  } as unknown as MCPServerContext;
  return new WebGPUHandlers(ctx);
}

/**
 * Mock page: install/uninstall/ensureState scripts return undefined;
 * getCapturedPipelines (the only script reading `pipelines: state.pipelines`)
 * returns the captured state.
 */
function makeMockPage(captured: { pipelines: any[]; totalCreated: number }) {
  return {
    url: () => 'https://example.com/',
    evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
      const src = typeof fn === 'function' ? String(fn) : '';
      if (src.includes('pipelines: state.pipelines')) {
        return captured; // getCapturedPipelines
      }
      return undefined; // ensureState / install / uninstall
    }),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ metrics: [] }),
      detach: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

describe('webgpu_pipeline_dump', () => {
  let ctx: MCPServerContext;
  let handlers: WebGPUHandlers;

  beforeEach(() => {
    ctx = {
      eventBus: { emit: () => {} },
      pageController: {
        getActivePage: async () => {
          throw new Error('No active page');
        },
      },
    } as unknown as MCPServerContext;
    handlers = new WebGPUHandlers(ctx);
  });

  it('should require an active page', async () => {
    const response = await handlers.webgpu_pipeline_dump({ captureCount: 5 });
    const result = ResponseBuilder.parse(response);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should reject a non-positive captureCount', async () => {
    handlers = makeHandlers(makeMockPage({ pipelines: [], totalCreated: 0 }));
    const response = await handlers.webgpu_pipeline_dump({ captureCount: 0 });
    const result = ResponseBuilder.parse(response);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/captureCount|invalid|> 0/i),
    });
  });

  it('captures pipeline descriptors with kind + method', async () => {
    const captured = {
      pipelines: [
        {
          kind: 'render',
          method: 'createRenderPipeline',
          descriptor: { vertex: { entryPoint: 'vs_main' }, fragment: { entryPoint: 'fs_main' } },
          label: 'opaque',
          timestamp: 1,
        },
        {
          kind: 'bind-group-layout',
          method: 'createBindGroupLayout',
          descriptor: { entries: [{ binding: 0, visibility: 2 }] },
          timestamp: 2,
        },
      ],
      totalCreated: 2,
    };
    handlers = makeHandlers(makeMockPage(captured));

    const response = await handlers.webgpu_pipeline_dump({ captureCount: 2 });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.capturedCount).toBe(2);
    expect(result.totalCreated).toBe(2);
    expect(result.pipelines).toHaveLength(2);
    expect(result.pipelines[0].kind).toBe('render');
    expect(result.pipelines[0].label).toBe('opaque');
    expect(result.pipelines[1].kind).toBe('bind-group-layout');
    expect(result.captureTimedOut).toBe(false);
  });

  it('reports captureTimedOut when fewer pipelines than requested', async () => {
    const captured = {
      pipelines: [
        { kind: 'compute', method: 'createComputePipeline', descriptor: {}, timestamp: 1 },
      ],
      totalCreated: 1,
    };
    handlers = makeHandlers(makeMockPage(captured));

    const response = await handlers.webgpu_pipeline_dump({
      captureCount: 5,
      timeoutMs: 120,
    });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.capturedCount).toBe(1);
    expect(result.captureTimedOut).toBe(true);
  });
});
