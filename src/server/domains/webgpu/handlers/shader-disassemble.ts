import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argString } from '@server/domains/shared/parse-args';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { getShaderDisassemblyCache } from '@modules/webgpu/ShaderCache';
import { extractShaderAst } from '@modules/webgpu/WgslParser';
import { isSpirv, decodeSpirvInput, parseSpirv } from '@modules/webgpu/SpirvParser';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies, ShaderMetadata } from '../types';

interface ShaderAst {
  type: 'Module';
  functions: string[];
  structs: ShaderMetadata['structs'];
  uniforms: ShaderMetadata['uniforms'];
  attributes: ShaderMetadata['attributes'];
  parseWarnings?: string[];
}

/**
 * Handler for webgpu_shader_disassemble tool
 * Parses WGSL shader into AST and generates human-readable disassembly.
 *
 * Supports WGSL (enhanced brace-matching parser) and SPIR-V (binary reflection
 * with a human-readable disassembly of entry points, bindings, and structs).
 */
export class ShaderDisassembleHandler {
  private ddm: DetailedDataManager;
  private disassemblyCache = getShaderDisassemblyCache();

  constructor(
    private ctx: MCPServerContext,
    _deps: WebGPUDomainDependencies,
  ) {
    this.ddm = DetailedDataManager.getInstance();
  }

  async handle(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const shaderCode = argString(args, 'shaderCode');
      if (!shaderCode) {
        throw new Error('Missing required argument: shaderCode');
      }

      const format = argString(args, 'format', 'wgsl');

      // Check cache first
      const cached = this.disassemblyCache.get(shaderCode);
      if (cached) {
        return {
          ...cached,
          _cached: true,
        };
      }

      // Report progress for large shaders
      const meta = args['_meta'] as Record<string, unknown> | undefined;
      const progressToken = meta ? argString(meta, 'progressToken') : undefined;

      if (progressToken && shaderCode.length > 10000) {
        this.reportProgress(progressToken, 0.1, 'Parsing shader AST...');
      }

      let result: { ast: ShaderAst; disassembly: string };

      if (format === 'spirv') {
        result = this.disassembleSpirv(shaderCode);
      } else if (format === 'wgsl') {
        const ast = extractShaderAst(shaderCode);

        if (progressToken && shaderCode.length > 10000) {
          this.reportProgress(progressToken, 0.5, 'Generating disassembly...');
        }

        const disassembly = this.generateDisassembly(shaderCode);
        result = { ast, disassembly };
      } else {
        throw new Error(`Unsupported format: "${format}". Only "wgsl" and "spirv" are supported.`);
      }

      if (progressToken && shaderCode.length > 10000) {
        this.reportProgress(progressToken, 1.0, 'Disassembly complete');
      }

      // Cache the result before offloading
      this.disassemblyCache.set(shaderCode, result);

      return this.ddm.smartHandle(result, 25000);
    });
  }

  /**
   * Disassemble a SPIR-V binary: reflect metadata and produce a human-readable
   * text dump of entry points, bindings, structs, and locations.
   */
  private disassembleSpirv(input: string): { ast: ShaderAst; disassembly: string } {
    const decoded = decodeSpirvInput(input);
    if (decoded.format === 'invalid') {
      throw new Error(
        'SPIR-V input could not be decoded. Provide a hex string (e.g. "07230203..."), a base64 string, or raw bytes.',
      );
    }

    if (!isSpirv(decoded.bytes)) {
      throw new Error('Input is not a valid SPIR-V binary: magic 0x07230203 not found.');
    }

    const reflect = parseSpirv(decoded.bytes);

    const ast: ShaderAst = {
      type: 'Module',
      functions: reflect.entryPoints.map((ep) => ep.name),
      structs: reflect.structs.map((s) => ({ name: s.name, fields: s.fields })),
      uniforms: reflect.bindings.map((b) => ({ name: b.name, binding: b.binding, group: b.group })),
      attributes: reflect.locations.map((l) => ({ name: l.name, location: l.location })),
      parseWarnings: reflect.warnings,
    };

    const lines: string[] = [];
    lines.push(`; SPIR-V disassembly (reflection)`);
    lines.push(`; version: ${reflect.versionMajor}.${reflect.versionMinor}`);
    lines.push(`; generator: ${reflect.generator}`);
    lines.push(`; bound: ${reflect.bound}`);
    lines.push('');
    lines.push('; Entry Points:');
    for (const ep of reflect.entryPoints) {
      lines.push(`  ${ep.stage}: ${ep.name}`);
    }
    lines.push('');
    lines.push('; Bindings:');
    for (const b of reflect.bindings) {
      lines.push(`  @group(${b.group}) @binding(${b.binding}) : ${b.name}`);
    }
    lines.push('');
    lines.push('; Locations:');
    for (const l of reflect.locations) {
      lines.push(`  @location(${l.location}) : ${l.name}`);
    }
    lines.push('');
    lines.push('; Structs:');
    for (const s of reflect.structs) {
      lines.push(`  struct ${s.name} {`);
      for (const f of s.fields) {
        lines.push(`    ${f.name} : ${f.type}`);
      }
      lines.push(`  }`);
    }
    if (reflect.warnings.length > 0) {
      lines.push('');
      lines.push('; Warnings:');
      for (const w of reflect.warnings) {
        lines.push(`  ; ${w}`);
      }
    }

    return { ast, disassembly: lines.join('\n') };
  }

  private generateDisassembly(shaderCode: string): string {
    // Simple disassembly - real implementation would use proper WGSL parser
    const lines = shaderCode.split('\n');
    return lines.map((line, idx) => `${String(idx + 1).padStart(4, ' ')} | ${line}`).join('\n');
  }

  private reportProgress(token: string | undefined, progress: number, _message: string): void {
    if (!token || !this.ctx.eventBus) {
      return;
    }

    this.ctx.eventBus.emit('tool:progress', {
      progressToken: token,
      progress,
      timestamp: new Date().toISOString(),
    });
  }
}
