import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argString } from '@server/domains/shared/parse-args';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { getShaderCompileCache } from '@modules/webgpu/ShaderCache';
import { extractShaderMetadata } from '@modules/webgpu/WgslParser';
import { isSpirv, decodeSpirvInput, parseSpirv } from '@modules/webgpu/SpirvParser';
import { ensureDevice } from '@modules/webgpu/CDPIntegration';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies, ShaderMetadata } from '../types';

/**
 * Handler for webgpu_shader_compile tool
 * Compiles WGSL shader and extracts metadata (entry points, bindings, attributes)
 *
 * Supports two formats:
 *  - `wgsl`:  Compiled and validated on the real GPU via the browser WebGPU API.
 *             Metadata is extracted by the enhanced WGSL parser.
 *  - `spirv`: Static reflection only. Browsers cannot compile SPIR-V directly
 *             (WebGPU accepts only WGSL), so the SPIR-V binary is parsed for
 *             metadata and compilation is reported as skipped with a guidance
 *             note. Use an external tool (e.g. spirv-cross) to convert SPIR-V
 *             to WGSL when GPU-side validation is required.
 */
export class ShaderCompileHandler {
  private pageLockManager = getPageLockManager();
  private compileCache = getShaderCompileCache();

  constructor(
    _ctx: MCPServerContext,
    private deps: WebGPUDomainDependencies,
  ) {}

  async handle(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const shaderCode = argString(args, 'shaderCode');
      if (!shaderCode) {
        throw new Error('Missing required argument: shaderCode');
      }

      const format = argString(args, 'format', 'wgsl');

      // Check cache first
      const cached = this.compileCache.get(shaderCode);
      if (cached) {
        return {
          ...cached,
          _cached: true,
        };
      }

      if (format === 'spirv') {
        return this.handleSpirv(shaderCode);
      }

      if (format !== 'wgsl') {
        throw new Error(`Unsupported format: "${format}". Only "wgsl" and "spirv" are supported.`);
      }

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock to prevent concurrent GPU context access
      const result = await this.pageLockManager.withLock(pageId, async () => {
        // Ensure a cached adapter/device exists (shared across WebGPU tools).
        await ensureDevice(page);

        return await page.evaluate(async (code: string) => {
          const cache = (window as any).__webgpuDeviceCache;
          if (!cache || !cache.device) {
            throw new Error('WebGPU device cache unavailable. Call ensureDevice first.');
          }
          const device = cache.device;

          try {
            // Compile and validate shader on real GPU
            device.createShaderModule({
              code,
            });

            return { compiled: true };
          } catch (err: any) {
            throw new Error(`Shader compilation failed: ${err.message}`, { cause: err });
          }
        }, shaderCode);
      });

      // Extract metadata from shader source (pure parsing, no GPU needed)
      const metadata = extractShaderMetadata(shaderCode);

      // Cache and return combined result
      const combined = { ...result, metadata };
      this.compileCache.set(shaderCode, combined);
      return combined;
    });
  }

  /**
   * SPIR-V path: pure static reflection (browsers cannot compile SPIR-V).
   * Validates the magic, parses reflection metadata, and reports compilation
   * as skipped with a conversion hint.
   */
  private handleSpirv(input: string): Record<string, unknown> {
    const decoded = decodeSpirvInput(input);
    if (decoded.format === 'invalid') {
      throw new Error(
        'SPIR-V input could not be decoded. Provide a hex string (e.g. "07230203..."), a base64 string, or ensure the magic number 0x07230203 is present.',
      );
    }

    if (!isSpirv(decoded.bytes)) {
      throw new Error(
        'Input is not a valid SPIR-V binary: magic 0x07230203 not found at offset 0.',
      );
    }

    const reflect = parseSpirv(decoded.bytes);

    // Map SPIR-V reflection into the ShaderMetadata shape so consumers get a
    // uniform structure regardless of input format. SPIR-V has many more
    // execution models than WebGPU's three shader stages; collapse the extras
    // to 'compute' (closest analog) so the WGSL-shaped entry point union holds.
    const metadata: ShaderMetadata = {
      entryPoints: reflect.entryPoints.map((ep) => ({
        name: ep.name,
        stage: ep.stage === 'vertex' ? 'vertex' : ep.stage === 'fragment' ? 'fragment' : 'compute',
      })),
      uniforms: reflect.bindings.map((b) => ({ name: b.name, binding: b.binding, group: b.group })),
      attributes: reflect.locations.map((l) => ({ name: l.name, location: l.location })),
      structs: reflect.structs.map((s) => ({ name: s.name, fields: s.fields })),
      bindingsByType: {},
      parseWarnings: reflect.warnings,
      format: 'spirv',
    };

    return {
      compiled: false,
      compilationSkippedReason:
        'Browsers cannot compile SPIR-V directly (WebGPU accepts only WGSL). Use spirv-cross or spirv-tools to convert SPIR-V to WGSL for GPU-side compilation.',
      reflected: true,
      spirvInfo: {
        versionMajor: reflect.versionMajor,
        versionMinor: reflect.versionMinor,
        generator: reflect.generator,
        bound: reflect.bound,
      },
      metadata,
    };
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
