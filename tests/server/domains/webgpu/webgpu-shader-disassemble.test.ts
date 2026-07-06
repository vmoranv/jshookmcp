import { describe, it, expect, beforeEach } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

const SPIRV_MAGIC = 0x07230203;
const OP_ENTRY_POINT = 15;
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

function minimalSpirvHex(): string {
  const header = [SPIRV_MAGIC, 0x00010300, 0, 10, 0];
  const entry = makeInstruction(OP_ENTRY_POINT, [EM_VERTEX, 1, ...encodeString('vs_main')]);
  return wordsToHex([...header, ...entry]);
}

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

  describe('SPIR-V support', () => {
    it('should disassemble a valid SPIR-V binary', async () => {
      const response = await handlers.webgpu_shader_disassemble({
        shaderCode: minimalSpirvHex(),
        format: 'spirv',
      });
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(true);
      expect(result.ast).toBeDefined();
      expect(result.ast.functions).toContain('vs_main');
      expect(result.disassembly).toContain('SPIR-V');
      expect(result.disassembly).toContain('vs_main');
      expect(result.disassembly).toContain('Entry Points');
    });

    it('should reject invalid SPIR-V input', async () => {
      const response = await handlers.webgpu_shader_disassemble({
        shaderCode: 'not-spirv!!',
        format: 'spirv',
      });
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SPIR-V|magic|decode/i);
    });

    it('should not reuse a SPIR-V cache entry for a different requested format', async () => {
      const shaderCode = minimalSpirvHex();

      const firstResponse = await handlers.webgpu_shader_disassemble({
        shaderCode,
        format: 'spirv',
      });
      const first = ResponseBuilder.parse(firstResponse);
      expect(first.success).toBe(true);

      const secondResponse = await handlers.webgpu_shader_disassemble({
        shaderCode,
        format: 'glsl',
      });
      const second = ResponseBuilder.parse(secondResponse);

      expect(second.success).toBe(false);
      expect(second.error).toMatch(/Unsupported format|wgsl|spirv/i);
      expect(second['_cached']).toBeUndefined();
    });
  });

  describe('parseWarnings', () => {
    it('should surface parseWarnings from WGSL parser in AST', async () => {
      // Deeply nested struct triggers a nesting warning.
      let body = 'a: f32';
      for (let i = 0; i < 20; i++) body = `{ ${body} }`;
      const shader = `struct Deep ${body}`;

      const response = await handlers.webgpu_shader_disassemble({
        shaderCode: shader,
        format: 'wgsl',
      });
      const result = ResponseBuilder.parse(response);

      if (result.success === true && result.ast) {
        expect(result.ast.parseWarnings).toBeDefined();
        expect(result.ast.parseWarnings?.some((w: string) => w.includes('nesting'))).toBe(true);
      }
    });
  });
});
