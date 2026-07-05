/**
 * WASM domain — composition facade.
 *
 * External tool operations in ./handlers/external-tool-handlers.ts.
 * Browser operations in ./handlers/browser-handlers.ts.
 */

import { ExternalToolRunner, ToolRegistry } from '@server/domains/shared/modules';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { WasmSharedState } from './handlers/shared';
import { ExternalToolHandlers } from './handlers/external-tool-handlers';
import { BrowserHandlers } from './handlers/browser-handlers';
import { CapabilityHandlers } from './handlers/capability-handlers';

export type {
  EvalErrorResult,
  WasmDumpEvalResult,
  WasmVmpTraceEvalResult,
  WasmMemoryInspectEvalResult,
} from './handlers/shared';
export { isRecord, hasErrorResult } from './handlers/shared';

export class WasmToolHandlers {
  private state: WasmSharedState;
  private externalTools: ExternalToolHandlers;
  private browser: BrowserHandlers;
  private capabilities: CapabilityHandlers;

  constructor(collector: CodeCollector) {
    const registry = new ToolRegistry();
    const runner = new ExternalToolRunner(registry);
    this.state = { collector, runner };
    this.externalTools = new ExternalToolHandlers(this.state);
    this.browser = new BrowserHandlers(this.state);
    this.capabilities = new CapabilityHandlers(this.state);
  }

  handleWasmCapabilitiesTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmCapabilities());
  }

  handleWasmCapabilities() {
    return this.capabilities.handleWasmCapabilities();
  }
  handleWasmDumpTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmDump(args));
  }
  handleWasmDump(args: Record<string, unknown>) {
    return this.browser.handleWasmDump(args);
  }
  handleWasmDisassembleTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmDisassemble(args));
  }
  handleWasmDisassemble(args: Record<string, unknown>) {
    return this.externalTools.handleWasmDisassemble(args);
  }
  handleWasmDecompileTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmDecompile(args));
  }
  handleWasmDecompile(args: Record<string, unknown>) {
    return this.externalTools.handleWasmDecompile(args);
  }
  handleWasmInspectSectionsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmInspectSections(args));
  }
  handleWasmInspectSections(args: Record<string, unknown>) {
    return this.externalTools.handleWasmInspectSections(args);
  }
  handleWasmOfflineRunTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmOfflineRun(args));
  }
  handleWasmOfflineRun(args: Record<string, unknown>) {
    return this.externalTools.handleWasmOfflineRun(args);
  }
  handleWasmOptimizeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmOptimize(args));
  }
  handleWasmOptimize(args: Record<string, unknown>) {
    return this.externalTools.handleWasmOptimize(args);
  }
  handleWasmVmpTraceTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmVmpTrace(args));
  }
  handleWasmVmpTrace(args: Record<string, unknown>) {
    return this.browser.handleWasmVmpTrace(args);
  }
  handleWasmMemoryInspectTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmMemoryInspect(args));
  }
  handleWasmMemoryInspect(args: Record<string, unknown>) {
    return this.browser.handleWasmMemoryInspect(args);
  }
  handleWasmToCTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmToC(args));
  }
  handleWasmToC(args: Record<string, unknown>) {
    return this.externalTools.handleWasmToC(args);
  }
  handleWasmDetectObfuscationTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmDetectObfuscation(args));
  }
  handleWasmDetectObfuscation(args: Record<string, unknown>) {
    return this.externalTools.handleWasmDetectObfuscation(args);
  }
  handleWasmInstrumentTraceTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWasmInstrumentTrace(args));
  }
  handleWasmInstrumentTrace(args: Record<string, unknown>) {
    return this.externalTools.handleWasmInstrumentTrace(args);
  }
}
