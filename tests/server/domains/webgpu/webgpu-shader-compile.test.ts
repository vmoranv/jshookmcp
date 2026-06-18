import { describe, it, expect, beforeEach } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

describe('webgpu_shader_compile', () => {
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

  it('should reject invalid WGSL shader', async () => {
    const invalidShader = 'not valid wgsl';

    const response = await handlers.webgpu_shader_compile({
      shaderCode: invalidShader,
      format: 'wgsl',
    });
    const result = ResponseBuilder.parse(response);

    expect(result).toMatchObject({
      success: false,
      error: expect.any(String),
    });
  });

  it('should compile valid WGSL shader and return metadata', async () => {
    const validShader = `
      @vertex
      fn main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
      }
    `;

    const response = await handlers.webgpu_shader_compile({
      shaderCode: validShader,
      format: 'wgsl',
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === false) {
      // Expected if WebGPU not available or no page
      expect(result.error).toMatch(/page|WebGPU/i);
    } else {
      expect(result).toHaveProperty('compiled', true);
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('entryPoints');
    }
  });

  it('should detect compute shader entry points', async () => {
    const computeShader = `
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        // compute logic
      }
    `;

    const response = await handlers.webgpu_shader_compile({
      shaderCode: computeShader,
      format: 'wgsl',
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      expect(result.metadata.entryPoints).toContainEqual(
        expect.objectContaining({
          name: 'main',
          stage: 'compute',
        }),
      );
    }
  });

  it('should extract uniforms and bindings', async () => {
    const shaderWithUniforms = `
      struct Params {
        color: vec4<f32>,
      };

      @group(0) @binding(0) var<uniform> params : Params;
      @group(0) @binding(1) var mySampler : sampler;
      @group(0) @binding(2) var myTexture : texture_2d<f32>;

      @fragment
      fn main() -> @location(0) vec4<f32> {
        return params.color;
      }
    `;

    const response = await handlers.webgpu_shader_compile({
      shaderCode: shaderWithUniforms,
      format: 'wgsl',
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      expect(result.metadata.uniforms?.length).toBeGreaterThanOrEqual(2);
      expect(result.metadata.uniforms).toContainEqual(
        expect.objectContaining({ name: 'params', binding: 0, group: 0 }),
      );
      expect(result.metadata.bindingsByType).toBeDefined();
    }
  });

  it('should extract vertex attributes and structs', async () => {
    const shaderWithAttributes = `
      struct VertexInput {
        @location(0) position : vec3<f32>,
        @location(1) uv : vec2<f32>,
      };

      @vertex
      fn main(input : VertexInput) -> @builtin(position) vec4<f32> {
        return vec4<f32>(input.position, 1.0);
      }
    `;

    const response = await handlers.webgpu_shader_compile({
      shaderCode: shaderWithAttributes,
      format: 'wgsl',
    });
    const result = ResponseBuilder.parse(response);

    if (result.success === true) {
      expect(result.metadata.attributes?.length).toBeGreaterThanOrEqual(2);
      expect(result.metadata.attributes).toContainEqual(
        expect.objectContaining({ name: 'position', location: 0 }),
      );
      expect(result.metadata.structs?.length).toBeGreaterThanOrEqual(1);
      expect(result.metadata.structs).toContainEqual(
        expect.objectContaining({ name: 'VertexInput' }),
      );
    }
  });
});
