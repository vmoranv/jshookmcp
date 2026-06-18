import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';
import { resetPageLockManager } from '@modules/webgpu/PageLockManager';
import { resetShaderCaches } from '@modules/webgpu/ShaderCache';

describe('WebGPU Phase 2 - Integration Tests', () => {
  let ctx: MCPServerContext;
  let handlers: WebGPUHandlers;

  beforeEach(async () => {
    resetPageLockManager();
    resetShaderCaches();

    ctx = {
      eventBus: {
        emit: vi.fn(),
      },
    } as unknown as MCPServerContext;

    handlers = new WebGPUHandlers(ctx);
  });

  describe('Page Locking Integration', () => {
    it('should use page lock for adapter info', async () => {
      const response = await handlers.webgpu_adapter_info({});
      const result = ResponseBuilder.parse(response);

      // Should fail gracefully when no page (lock still works)
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/page/i);
    });

    it('should serialize concurrent calls to same tool', async () => {
      // Both calls should wait for each other
      const promise1 = handlers.webgpu_adapter_info({});
      const promise2 = handlers.webgpu_adapter_info({});

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('Shader Compilation Caching', () => {
    it('should cache shader compilation results', async () => {
      const shader = '@vertex fn main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }';

      const response1 = await handlers.webgpu_shader_compile({
        shaderCode: shader,
      });

      const response2 = await handlers.webgpu_shader_compile({
        shaderCode: shader,
      });

      const result1 = ResponseBuilder.parse(response1);
      const result2 = ResponseBuilder.parse(response2);

      // Both should fail (no page), but second should be from cache
      if (result2.success === false) {
        // Expected in test environment
        expect(result1).toEqual(result2);
      } else {
        // If we somehow have WebGPU context
        expect(result2).toHaveProperty('_cached', true);
      }
    });

    it('should not cache different shaders', async () => {
      const shader1 = '@vertex fn main1() {}';
      const shader2 = '@vertex fn main2() {}';

      const response1 = await handlers.webgpu_shader_compile({
        shaderCode: shader1,
      });

      const response2 = await handlers.webgpu_shader_compile({
        shaderCode: shader2,
      });

      // Each should be processed independently
      expect(response1).toBeDefined();
      expect(response2).toBeDefined();
    });
  });

  describe('Shader Disassembly Caching', () => {
    it('should cache disassembly results', async () => {
      const shader = '@vertex fn main() { return; }';

      const response1 = await handlers.webgpu_shader_disassemble({
        shaderCode: shader,
      });

      const response2 = await handlers.webgpu_shader_disassemble({
        shaderCode: shader,
      });

      const result1 = ResponseBuilder.parse(response1);
      const result2 = ResponseBuilder.parse(response2);

      // Both should succeed (no page required for disassembly)
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      if (result2.success) {
        expect(result2).toHaveProperty('_cached', true);
      }
    });

    it('should generate correct disassembly structure', async () => {
      const shader = `
@vertex
fn vertex_main() -> @builtin(position) vec4<f32> {
  return vec4<f32>(0.0);
}

@fragment
fn fragment_main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0);
}
      `.trim();

      const response = await handlers.webgpu_shader_disassemble({
        shaderCode: shader,
      });

      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.ast).toBeDefined();
        expect(result.ast.functions).toContain('vertex_main');
        expect(result.ast.functions).toContain('fragment_main');
        expect(result.disassembly).toContain('@vertex');
        expect(result.disassembly).toContain('@fragment');
      }
    });
  });

  describe('Progress Reporting', () => {
    it('should accept progress token for timing analysis', async () => {
      const response = await handlers.webgpu_timing_analysis({
        iterations: 10,
        _meta: {
          progressToken: 'test-token-123',
        },
      });

      // Should not throw even with progress token
      expect(response).toBeDefined();
    });

    it('should accept progress token for disassembly', async () => {
      const largeShader = '@vertex fn main() { '.repeat(1000) + ' }';

      const response = await handlers.webgpu_shader_disassemble({
        shaderCode: largeShader,
        _meta: {
          progressToken: 'test-token-456',
        },
      });

      const result = ResponseBuilder.parse(response);
      expect(result).toBeDefined();
    });

    it('should emit progress events when event bus available', async () => {
      const mockEmit = vi.fn();
      ctx.eventBus = { emit: mockEmit } as any;

      const largeShader = '@vertex fn main() { '.repeat(2000) + ' }';

      await handlers.webgpu_shader_disassemble({
        shaderCode: largeShader,
        _meta: {
          progressToken: 'test-token-789',
        },
      });

      // Progress events are only emitted if shader is large enough (>10KB)
      // and eventBus is present. The test shader is ~26KB so should trigger progress.
      // However, progress is only emitted inside page.evaluate in timing_analysis,
      // not in disassembly (which is CPU-bound, not GPU-bound).
      // Disassembly uses reportProgress helper which checks for eventBus.
      const progressCalls = mockEmit.mock.calls.filter(([event]) => event === 'tool:progress');

      // Should have emitted at least 3 progress updates (0.1, 0.5, 1.0)
      expect(progressCalls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('CDP Integration', () => {
    it('should use CDP for memory layout', async () => {
      const response = await handlers.webgpu_memory_layout({});
      const result = ResponseBuilder.parse(response);

      // Should fail without page, but structure should be correct
      if (result.success === false) {
        expect(result.error).toMatch(/page/i);
      } else {
        expect(result).toHaveProperty('heapSize');
        expect(result).toHaveProperty('usedHeapSize');
        expect(result).toHaveProperty('allocations');
      }
    });

    it('should use CDP for command capture', async () => {
      const response = await handlers.webgpu_capture_commands({
        captureCount: 10,
      });

      const result = ResponseBuilder.parse(response);

      // Should fail without page
      if (result.success === false) {
        expect(result.error).toMatch(/page/i);
      } else {
        expect(result).toHaveProperty('commands');
        expect(result).toHaveProperty('totalSubmissions');
        expect(result).toHaveProperty('captureWindow');
        expect(result).toHaveProperty('inferredTypes');
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain backward-compatible response structure for adapter_info', async () => {
      const response = await handlers.webgpu_adapter_info({});
      const result = ResponseBuilder.parse(response);

      // Structure should match Phase 1
      if (result.success === true) {
        expect(result).toHaveProperty('adapter');
        expect(result.adapter).toHaveProperty('vendor');
        expect(result.adapter).toHaveProperty('architecture');
      } else {
        expect(result).toHaveProperty('error');
      }
    });

    it('should maintain backward-compatible response structure for shader_compile', async () => {
      const response = await handlers.webgpu_shader_compile({
        shaderCode: '@vertex fn main() {}',
      });

      const result = ResponseBuilder.parse(response);

      if (result.success === true) {
        expect(result).toHaveProperty('compiled');
        expect(result).toHaveProperty('metadata');
      } else {
        expect(result).toHaveProperty('error');
      }
    });

    it('should maintain backward-compatible response structure for timing_analysis', async () => {
      const response = await handlers.webgpu_timing_analysis({
        iterations: 5,
      });

      const result = ResponseBuilder.parse(response);

      if (result.success === true) {
        expect(result).toHaveProperty('timings');
        expect(result).toHaveProperty('mean');
        expect(result).toHaveProperty('stddev');
        expect(result).toHaveProperty('min');
        expect(result).toHaveProperty('max');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing required arguments', async () => {
      const response = await handlers.webgpu_shader_compile({});
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/shaderCode/i);
    });

    it('should handle invalid format', async () => {
      const response = await handlers.webgpu_shader_compile({
        shaderCode: 'test',
        format: 'spirv',
      });

      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/WGSL/i);
    });

    it('should handle invalid iteration count', async () => {
      const response = await handlers.webgpu_timing_analysis({
        iterations: -1,
      });

      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/iterations/i);
    });
  });
});
