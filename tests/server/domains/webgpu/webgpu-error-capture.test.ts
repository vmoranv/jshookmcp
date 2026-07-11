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
 * getCapturedErrors (the only script reading `errors: state.errors`) returns
 * the captured state.
 */
function makeMockPage(captured: { errors: any[]; deviceLost: any; totalErrors: number }) {
  return {
    url: () => 'https://example.com/',
    evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
      const src = typeof fn === 'function' ? String(fn) : '';
      if (src.includes('errors: state.errors')) {
        return captured; // getCapturedErrors
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

describe('webgpu_error_capture', () => {
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
    const response = await handlers.webgpu_error_capture({ captureCount: 5 });
    const result = ResponseBuilder.parse(response);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should reject a non-positive captureCount', async () => {
    handlers = makeHandlers(makeMockPage({ errors: [], deviceLost: null, totalErrors: 0 }));
    const response = await handlers.webgpu_error_capture({ captureCount: 0 });
    const result = ResponseBuilder.parse(response);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/captureCount|invalid|> 0/i),
    });
  });

  it('captures validation errors and device-lost state', async () => {
    const captured = {
      errors: [
        { type: 'validation', message: 'Buffer size must be > 0', timestamp: 1 },
        { type: 'out-of-memory', message: 'Allocation exceeded', timestamp: 2 },
      ],
      deviceLost: { reason: 'unknown', message: 'GPU reset' },
      totalErrors: 2,
    };
    handlers = makeHandlers(makeMockPage(captured));

    const response = await handlers.webgpu_error_capture({ captureCount: 2 });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.capturedCount).toBe(2);
    expect(result.totalErrors).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].type).toBe('validation');
    expect(result.captureTimedOut).toBe(false);
    expect(result.deviceLost).toEqual({ reason: 'unknown', message: 'GPU reset' });
  });

  it('reports captureTimedOut when fewer errors than requested', async () => {
    const captured = {
      errors: [{ type: 'validation', message: 'one', timestamp: 1 }],
      deviceLost: null,
      totalErrors: 1,
    };
    handlers = makeHandlers(makeMockPage(captured));

    const response = await handlers.webgpu_error_capture({
      captureCount: 5,
      timeoutMs: 120,
    });
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.capturedCount).toBe(1);
    expect(result.captureTimedOut).toBe(true);
  });

  it('threads wrapAllocations through to the result', async () => {
    const captured = { errors: [], deviceLost: null, totalErrors: 0 };
    handlers = makeHandlers(makeMockPage(captured));

    const response = await handlers.webgpu_error_capture({
      captureCount: 1,
      timeoutMs: 120,
      wrapAllocations: true,
    });
    const result = ResponseBuilder.parse(response);
    expect(result.success).toBe(true);
    expect(result.wrapAllocations).toBe(true);
  });
});
