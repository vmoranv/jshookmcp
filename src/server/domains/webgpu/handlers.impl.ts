import type { MCPServerContext } from '@server/domains/shared/registry';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { WebGPUDomainDependencies } from './types';
import {
  AdapterInfoHandler,
  ShaderCompileHandler,
  ShaderDisassembleHandler,
  TimingAnalysisHandler,
  MemoryLayoutHandler,
  CommandCaptureHandler,
  ShaderSourceCaptureHandler,
} from './handlers/index.js';

/**
 * WebGPU domain handlers facade
 * Delegates to modular handler classes for each tool
 */
export class WebGPUHandlers {
  private adapterInfoHandler: AdapterInfoHandler;
  private shaderCompileHandler: ShaderCompileHandler;
  private shaderDisassembleHandler: ShaderDisassembleHandler;
  private timingAnalysisHandler: TimingAnalysisHandler;
  private memoryLayoutHandler: MemoryLayoutHandler;
  private commandCaptureHandler: CommandCaptureHandler;
  private shaderSourceCaptureHandler: ShaderSourceCaptureHandler;

  constructor(_ctx: MCPServerContext, deps?: WebGPUDomainDependencies) {
    const d = deps ?? {
      pageController: _ctx.pageController as WebGPUDomainDependencies['pageController'],
    };

    this.adapterInfoHandler = new AdapterInfoHandler(_ctx, d);
    this.shaderCompileHandler = new ShaderCompileHandler(_ctx, d);
    this.shaderDisassembleHandler = new ShaderDisassembleHandler(_ctx, d);
    this.timingAnalysisHandler = new TimingAnalysisHandler(_ctx, d);
    this.memoryLayoutHandler = new MemoryLayoutHandler(_ctx, d);
    this.commandCaptureHandler = new CommandCaptureHandler(_ctx, d);
    this.shaderSourceCaptureHandler = new ShaderSourceCaptureHandler(_ctx, d);
  }

  async webgpu_adapter_info(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.adapterInfoHandler.handle(args);
  }

  async webgpu_shader_compile(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.shaderCompileHandler.handle(args);
  }

  async webgpu_shader_disassemble(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.shaderDisassembleHandler.handle(args);
  }

  async webgpu_timing_analysis(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.timingAnalysisHandler.handle(args);
  }

  async webgpu_memory_layout(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.memoryLayoutHandler.handle(args);
  }

  async webgpu_capture_commands(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.commandCaptureHandler.handle(args);
  }

  async webgpu_shader_source_capture(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.shaderSourceCaptureHandler.handle(args);
  }
}

export default WebGPUHandlers;
