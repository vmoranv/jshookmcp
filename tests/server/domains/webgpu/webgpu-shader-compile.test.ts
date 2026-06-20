import { describe, it, expect, beforeEach } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

// SPIR-V opcodes / enums needed to build a minimal valid module.
const SPIRV_MAGIC = 0x07230203;
const OP_ENTRY_POINT = 15;
const OP_NAME = 19;
const EM_VERTEX = 0;

function wordsToHex(words: number[]): string {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setUint32(i * 4, w >>> 0, true));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function encodeString(s: string): number[] {
  const bytes = [...new TextEncoder().encode(s), 0];
  while (bytes.length % 4 !== 0) bytes.push(0);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24));
  }
  return words;
}

function makeInstruction(opcode: number, operands: number[]): number[] {
  const wordCount = 1 + operands.length;
  return [(wordCount << 16) | opcode, ...operands];
}

/** Build a minimal SPIR-V module with one vertex entry point named `vs_main`. */
function minimalSpirvHex(): string {
  const header = [SPIRV_MAGIC, 0x00010300, 0, 10, 0];
  const entry = makeInstruction(OP_ENTRY_POINT, [EM_VERTEX, 1, ...encodeString('vs_main')]);
  const name = makeInstruction(OP_NAME, [1, ...encodeString('vs_main')]);
  return wordsToHex([...header, ...entry, ...name]);
}

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

  describe('SPIR-V support', () => {
    it('should reflect a valid SPIR-V binary without requiring a browser', async () => {
      const response = await handlers.webgpu_shader_compile({
        shaderCode: minimalSpirvHex(),
        format: 'spirv',
      });
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(true);
      expect(result.compiled).toBe(false);
      expect(result.reflected).toBe(true);
      expect(result.compilationSkippedReason).toMatch(/SPIR-V|WGSL|spirv-cross/i);
      expect(result.spirvInfo).toBeDefined();
      expect(result.metadata.entryPoints).toContainEqual(
        expect.objectContaining({ name: 'vs_main', stage: 'vertex' }),
      );
      expect(result.metadata.format).toBe('spirv');
    });

    it('should reject non-SPIR-V input in spirv format', async () => {
      const response = await handlers.webgpu_shader_compile({
        shaderCode: 'this-is-not-hex-or-spirv!!',
        format: 'spirv',
      });
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SPIR-V|magic|decode/i);
    });

    it('should reject unsupported format', async () => {
      const response = await handlers.webgpu_shader_compile({
        shaderCode: 'test',
        format: 'glsl',
      });
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unsupported format|wgsl|spirv/i);
    });
  });

  describe('parseWarnings', () => {
    it('should include parseWarnings array in metadata (empty for valid shader)', async () => {
      // This shader has no page, so compilation fails — but metadata extraction
      // still runs for the WGSL path only when a page is present. Test the
      // parser directly via the SPIR-V path which always returns metadata.
      const response = await handlers.webgpu_shader_compile({
        shaderCode: minimalSpirvHex(),
        format: 'spirv',
      });
      const result = ResponseBuilder.parse(response);

      if (result.success === true) {
        expect(Array.isArray(result.metadata.parseWarnings)).toBe(true);
      }
    });
  });
});
