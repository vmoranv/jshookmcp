import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argString } from '@server/domains/shared/parse-args';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { getShaderCompileCache } from '@modules/webgpu/ShaderCache';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies, ShaderMetadata } from '../types';

/**
 * Extract shader metadata from WGSL source code.
 *
 * Parses entry points, uniforms/bindings, vertex attributes, and structs.
 * This is a lightweight parser sufficient for security analysis and reverse
 * engineering; it does not require an external WGSL grammar dependency.
 *
 * @param code - WGSL source code
 * @returns Structured shader metadata
 */
function extractShaderMetadata(code: string): ShaderMetadata {
  const entryPoints: ShaderMetadata['entryPoints'] = [];
  const uniforms: NonNullable<ShaderMetadata['uniforms']> = [];
  const attributes: NonNullable<ShaderMetadata['attributes']> = [];
  const structs: NonNullable<ShaderMetadata['structs']> = [];
  const bindingsByType: NonNullable<ShaderMetadata['bindingsByType']> = {};

  // Entry points
  const vertexMatch = code.match(/@vertex\s+fn\s+(\w+)/);
  const fragmentMatch = code.match(/@fragment\s+fn\s+(\w+)/);
  const computeMatch = code.match(/@compute\s+fn\s+(\w+)/);

  if (vertexMatch?.[1]) {
    entryPoints.push({ name: vertexMatch[1], stage: 'vertex' });
  }
  if (fragmentMatch?.[1]) {
    entryPoints.push({ name: fragmentMatch[1], stage: 'fragment' });
  }
  if (computeMatch?.[1]) {
    entryPoints.push({ name: computeMatch[1], stage: 'compute' });
  }

  // Structs: `struct Name { field: type, ... }`
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

  // Uniforms / bindings: `@group(g) @binding(b) var<...> name : type`
  const bindingRegex =
    /@group\s*\(\s*(\d+)\s*\)\s*@binding\s*\(\s*(\d+)\s*\)[\s\S]*?var[\s\S]*?(\w+)\s*:\s*([\w\s<>*(),]+)/g;
  for (const match of code.matchAll(bindingRegex)) {
    const groupStr = match[1];
    const bindingStr = match[2];
    const name = match[3];
    const type = match[4];
    if (
      groupStr === undefined ||
      bindingStr === undefined ||
      name === undefined ||
      type === undefined
    )
      continue;
    const group = Number(groupStr);
    const binding = Number(bindingStr);

    uniforms.push({ name, binding, group });

    const baseType = type.split('<')[0]?.split('(')[0]?.trim() ?? 'unknown';
    bindingsByType[baseType] = (bindingsByType[baseType] ?? 0) + 1;
  }

  // Vertex attributes: `@location(l) name : type` inside function params
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

  const metadata: ShaderMetadata = {
    entryPoints,
    uniforms,
    attributes,
    structs,
    bindingsByType,
  };

  return metadata;
}

/**
 * Handler for webgpu_shader_compile tool
 * Compiles WGSL shader and extracts metadata (entry points, bindings, attributes)
 */
export class ShaderCompileHandler {
  private pageLockManager = getPageLockManager();
  private compileCache = getShaderCompileCache();

  constructor(
    private ctx: MCPServerContext,
    private deps: WebGPUDomainDependencies,
  ) {}

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
      const cached = this.compileCache.get(shaderCode);
      if (cached) {
        return {
          ...cached,
          _cached: true,
        };
      }

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock to prevent concurrent GPU context access
      const result = await this.pageLockManager.withLock(pageId, async () => {
        return await page.evaluate(async (code: string) => {
          if (!navigator.gpu) {
            throw new Error('WebGPU not available');
          }

          const adapter = await navigator.gpu.requestAdapter();
          if (!adapter) {
            throw new Error('Failed to request GPU adapter');
          }

          const device = await adapter.requestDevice();

          try {
            // Compile and validate shader
            device.createShaderModule({
              code,
            });

            // Extract metadata from shader code
            const metadata = extractShaderMetadata(code);

            return {
              compiled: true,
              metadata,
            };
          } catch (err: any) {
            throw new Error(`Shader compilation failed: ${err.message}`, { cause: err });
          }
        }, shaderCode);
      });

      // Cache the result
      this.compileCache.set(shaderCode, result);

      return result;
    });
  }

  private async getActivePage(): Promise<any> {
    if (!this.deps.pageController) {
      return null;
    }

    try {
      return await this.deps.pageController.getActivePage();
    } catch {
      return null;
    }
  }
}
