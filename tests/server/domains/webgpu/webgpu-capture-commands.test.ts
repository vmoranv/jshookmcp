import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

describe('webgpu_capture_commands', () => {
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
    const response = await handlers.webgpu_capture_commands({
      captureCount: 10,
    });
    const result = ResponseBuilder.parse(response);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should capture structured GPU commands', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
        // First call installs hook (no return needed)
        // Second call gets trace
        if (typeof fn === 'function' && String(fn).includes('__webgpuHookState')) {
          return {
            commands: [
              { type: 'render', drawCalls: 5, passLabel: 'main-pass', timestamp: 1.234 },
              { type: 'compute', dispatches: { x: 8, y: 1, z: 1 }, timestamp: 1.456 },
              { type: 'copy', drawCalls: 2, timestamp: 1.478 },
            ],
            totalSubmissions: 1,
            captureStartTime: 1.0,
            captureEndTime: 2.0,
          };
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

    const response = await handlers.webgpu_capture_commands({
      captureCount: 10,
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      expect(result).toHaveProperty('commands');
      expect(result.commands).toBeInstanceOf(Array);
      expect(result.commands.length).toBeGreaterThan(0);

      const types = result.commands.map((c: any) => c.type);
      expect(types).toContain('render');
      expect(types).toContain('compute');
      expect(types).toContain('copy');
      expect(types).not.toContain('unknown');
    }
  });

  it('should include drawCalls and dispatches metadata', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
        if (typeof fn === 'function' && String(fn).includes('__webgpuHookState')) {
          return {
            commands: [
              { type: 'render', drawCalls: 10, pipelineLabel: 'opaque-pipeline', timestamp: 1.0 },
              {
                type: 'compute',
                dispatches: { x: 4, y: 4, z: 1 },
                pipelineLabel: 'cs-pipeline',
                timestamp: 2.0,
              },
            ],
            totalSubmissions: 1,
            captureStartTime: 1.0,
            captureEndTime: 3.0,
          };
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

    const response = await handlers.webgpu_capture_commands({
      captureCount: 2,
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true && result.commands) {
      const renderCmd = result.commands.find((c: any) => c.type === 'render');
      const computeCmd = result.commands.find((c: any) => c.type === 'compute');

      expect(renderCmd).toBeDefined();
      expect(renderCmd.drawCalls).toBe(10);

      expect(computeCmd).toBeDefined();
      expect(computeCmd.dispatches).toMatchObject({ x: 4, y: 4, z: 1 });
    }
  });
});
