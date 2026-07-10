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

/** Mock page: install/uninstall (fn references createShaderModule) return undefined;
 * getCapturedShaders (fn references totalCreated) returns the captured state. */
function makeMockPage(captured: { shaders: any[]; totalCreated: number }) {
  return {
    url: () => 'https://example.com/',
    evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
      const src = typeof fn === 'function' ? String(fn) : '';
      if (src.includes('createShaderModule')) {
        return undefined; // install / uninstall / reset
      }
      if (src.includes('totalCreated')) {
        return captured; // getCapturedShaders
      }
      return undefined; // ensureShaderHookState
    }),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ metrics: [] }),
      detach: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

describe('webgpu_shader_source_capture', () => {
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
    const response = await handlers.webgpu_shader_source_capture({ captureCount: 5 });
    const result = ResponseBuilder.parse(response);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should capture shader sources the app compiles', async () => {
    const captured = {
      shaders: [
        {
          code: '@compute @workgroup_size(64) fn main() {}',
          label: 'compute-shader',
          timestamp: 1.0,
        },
        { code: '@vertex fn v() {}', timestamp: 2.0 },
      ],
      totalCreated: 2,
    };
    handlers = makeHandlers(makeMockPage(captured));

    const response = await handlers.webgpu_shader_source_capture({ captureCount: 2 });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.capturedCount).toBe(2);
    expect(result.totalCreated).toBe(2);
    expect(result.shaders).toHaveLength(2);
    expect(result.shaders[0].code).toContain('@compute');
    expect(result.captureTimedOut).toBe(false);
  });

  it('should report captureTimedOut when fewer shaders than requested', async () => {
    const captured = {
      shaders: [{ code: '@vertex fn v() {}', timestamp: 1.0 }],
      totalCreated: 1,
    };
    handlers = makeHandlers(makeMockPage(captured));

    const response = await handlers.webgpu_shader_source_capture({
      captureCount: 5,
      timeoutMs: 120,
    });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.capturedCount).toBe(1);
    expect(result.captureTimedOut).toBe(true);
  });
});
