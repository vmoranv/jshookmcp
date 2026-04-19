/**
 * WASM domain — composition facade.
 *
 * External tool operations in ./handlers/external-tool-handlers.ts.
 * Browser operations in ./handlers/browser-handlers.ts.
 */

import { ExternalToolRunner, ToolRegistry } from '@server/domains/shared/modules';
import type { CodeCollector } from '@server/domains/shared/modules';
import type { WasmSharedState } from './handlers/shared';
import { ExternalToolHandlers } from './handlers/external-tool-handlers';
import { BrowserHandlers } from './handlers/browser-handlers';

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

  constructor(collector: CodeCollector) {
    const registry = new ToolRegistry();
    const runner = new ExternalToolRunner(registry);
    this.state = { collector, runner };
    this.externalTools = new ExternalToolHandlers(this.state);
    this.browser = new BrowserHandlers(this.state);
  }

  handleWasmDump(args: Record<string, unknown>) {
    return this.browser.handleWasmDump(args);
  }
  handleWasmDisassemble(args: Record<string, unknown>) {
    return this.externalTools.handleWasmDisassemble(args);
  }
  handleWasmDecompile(args: Record<string, unknown>) {
    return this.externalTools.handleWasmDecompile(args);
  }
  handleWasmInspectSections(args: Record<string, unknown>) {
    return this.externalTools.handleWasmInspectSections(args);
  }
  handleWasmOfflineRun(args: Record<string, unknown>) {
    return this.externalTools.handleWasmOfflineRun(args);
  }
  handleWasmOptimize(args: Record<string, unknown>) {
    return this.externalTools.handleWasmOptimize(args);
  }
  handleWasmVmpTrace(args: Record<string, unknown>) {
    return this.browser.handleWasmVmpTrace(args);
  }
  handleWasmMemoryInspect(args: Record<string, unknown>) {
    return this.browser.handleWasmMemoryInspect(args);
  }
}
