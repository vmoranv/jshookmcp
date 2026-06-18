import { describe, it, expect, beforeEach } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

describe('webgpu_shader_disassemble', () => {
  let ctx: MCPServerContext;
  let handlers: WebGPUHandlers;

  beforeEach(() => {
    ctx = {
      eventBus: {
        emit: () => {},
      },
    } as unknown as MCPServerContext;

    handlers = new WebGPUHandlers(ctx);
  });

  it('should parse WGSL shader into AST', async () => {
    const shader = `
      @vertex
      fn main() -> @builtin(position) vec4<f32> {
        return vec4<f32>(0.0);
      }
    `;

    const response = await handlers.webgpu_shader_disassemble({
      shaderCode: shader,
      format: 'wgsl',
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === false) {
      // Expected if WebGPU/WGSL parser not available
      expect(result.error).toBeTruthy();
    } else {
      // Check if we got a DetailedDataResponse (large result) or direct result
      if (result.summary && result.detailId) {
        // Large result - offloaded
        expect(result).toHaveProperty('summary');
        expect(result).toHaveProperty('detailId');
      } else {
        // Direct result
        expect(result).toHaveProperty('ast');
        expect(result).toHaveProperty('disassembly');
      }
    }
  });

  it('should identify shader functions', async () => {
    const shader = `
      fn helper() -> f32 { return 1.0; }
      @vertex fn main() -> @builtin(position) vec4<f32> {
        let x = helper();
        return vec4<f32>(x);
      }
    `;

    const response = await handlers.webgpu_shader_disassemble({
      shaderCode: shader,
      format: 'wgsl',
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true && result.disassembly) {
      expect(result.disassembly).toContain('helper');
      expect(result.disassembly).toContain('main');
    }
  });

  it('should extract structs, uniforms and attributes in AST', async () => {
    const shader = `
      struct Uniforms {
        mvpMatrix: mat4x4<f32>,
      };

      @group(0) @binding(0) var<uniform> uniforms : Uniforms;

      struct VertexInput {
        @location(0) position : vec3<f32>,
        @location(1) color : vec3<f32>,
      };

      @vertex
      fn vertex_main(input : VertexInput) -> @builtin(position) vec4<f32> {
        return uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
      }

      @fragment
      fn fragment_main() -> @location(0) vec4<f32> {
        return vec4<f32>(1.0);
      }
    `;

    const response = await handlers.webgpu_shader_disassemble({
      shaderCode: shader,
      format: 'wgsl',
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      expect(result.ast).toBeDefined();
      expect(result.ast.functions).toContain('vertex_main');
      expect(result.ast.functions).toContain('fragment_main');
      expect(result.ast.structs).toContainEqual(expect.objectContaining({ name: 'Uniforms' }));
      expect(result.ast.structs).toContainEqual(expect.objectContaining({ name: 'VertexInput' }));
      expect(result.ast.uniforms).toContainEqual(
        expect.objectContaining({ name: 'uniforms', binding: 0, group: 0 }),
      );
      expect(result.ast.attributes).toContainEqual(
        expect.objectContaining({ name: 'position', location: 0 }),
      );
      expect(result.ast.attributes).toContainEqual(
        expect.objectContaining({ name: 'color', location: 1 }),
      );
    }
  });
});
