import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argString } from '@server/domains/shared/parse-args';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { getShaderDisassemblyCache } from '@modules/webgpu/ShaderCache';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies, ShaderMetadata } from '../types';

interface ShaderAst {
  type: 'Module';
  functions: string[];
  structs: ShaderMetadata['structs'];
  uniforms: ShaderMetadata['uniforms'];
  attributes: ShaderMetadata['attributes'];
}

/**
 * Extract a lightweight AST from WGSL source code.
 *
 * Captures functions, structs, uniforms/bindings, and vertex attributes.
 * This parser is intentionally dependency-free and robust enough for reverse
 * engineering and security analysis workflows.
 *
 * @param code - WGSL source code
 * @returns Shader AST
 */
function extractShaderAst(code: string): ShaderAst {
  const functions: string[] = [];
  const structs: NonNullable<ShaderMetadata['structs']> = [];
  const uniforms: NonNullable<ShaderMetadata['uniforms']> = [];
  const attributes: NonNullable<ShaderMetadata['attributes']> = [];

  // Functions (including entry points)
  for (const match of code.matchAll(/fn\s+(\w+)/g)) {
    const name = match[1];
    if (name === undefined) continue;
    functions.push(name);
  }

  // Structs
  const structRegex = /struct\s+(\w+)\s*\{([^}]*)\}/g;
  for (const match of code.matchAll(structRegex)) {
    const name = match[1];
    const body = match[2];
    if (!name || body === undefined) continue;
    const fields: Array<{ name: string; type: string }> = [];
    const fieldRegex = /(\w+)\s*:\s*([^,;]+)/g;
    for (const fieldMatch of body.matchAll(fieldRegex)) {
      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      if (fieldName === undefined || fieldType === undefined) continue;
      fields.push({
        name: fieldName.trim(),
        type: fieldType.trim(),
      });
    }
    structs.push({ name, fields });
  }

  // Uniforms / bindings
  const bindingRegex =
    /@group\s*\(\s*(\d+)\s*\)\s*@binding\s*\(\s*(\d+)\s*\)[\s\S]*?var[\s\S]*?(\w+)\s*:\s*([\w\s<>*(),]+)/g;
  for (const match of code.matchAll(bindingRegex)) {
    const groupStr = match[1];
    const bindingStr = match[2];
    const name = match[3];
    if (groupStr === undefined || bindingStr === undefined || name === undefined) continue;
    uniforms.push({
      group: Number(groupStr),
      binding: Number(bindingStr),
      name,
    });
  }

  // Vertex attributes
  const attributeRegex = /@location\s*\(\s*(\d+)\s*\)\s*(\w+)\s*:/g;
  for (const match of code.matchAll(attributeRegex)) {
    const locationStr = match[1];
    const name = match[2];
    if (locationStr === undefined || name === undefined) continue;
    attributes.push({
      location: Number(locationStr),
      name,
    });
  }

  return {
    type: 'Module',
    functions,
    structs,
    uniforms,
    attributes,
  };
}

/**
 * Handler for webgpu_shader_disassemble tool
 * Parses WGSL shader into AST and generates human-readable disassembly
 */
export class ShaderDisassembleHandler {
  private ddm: DetailedDataManager;
  private disassemblyCache = getShaderDisassemblyCache();

  constructor(
    private ctx: MCPServerContext,
    private deps: WebGPUDomainDependencies,
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
      if (format !== 'wgsl') {
        throw new Error('Only WGSL format is currently supported');
      }

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

      // AST extraction without external parser dependencies
      const ast = extractShaderAst(shaderCode);

      if (progressToken && shaderCode.length > 10000) {
        this.reportProgress(progressToken, 0.5, 'Generating disassembly...');
      }

      const disassembly = this.generateDisassembly(shaderCode);

      if (progressToken && shaderCode.length > 10000) {
        this.reportProgress(progressToken, 1.0, 'Disassembly complete');
      }

      // Check if disassembly is large and should be offloaded
      const result = {
        ast,
        disassembly,
      };

      // Cache the result before offloading
      this.disassemblyCache.set(shaderCode, result);

      return this.ddm.smartHandle(result, 25000);
    });
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
