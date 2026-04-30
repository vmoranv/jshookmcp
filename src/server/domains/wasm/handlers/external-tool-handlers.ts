import type { WasmSharedState } from './shared';
import { ExternalAnalysisHandlers } from './external-analysis-handlers';
import { ExternalConversionHandlers } from './external-conversion-handlers';
import { ExternalRuntimeHandlers } from './external-runtime-handlers';

export class ExternalToolHandlers {
  private readonly conversion: ExternalConversionHandlers;
  private readonly runtime: ExternalRuntimeHandlers;
  private readonly analysis: ExternalAnalysisHandlers;

  constructor(state: WasmSharedState) {
    this.conversion = new ExternalConversionHandlers(state);
    this.runtime = new ExternalRuntimeHandlers(state);
    this.analysis = new ExternalAnalysisHandlers(state);
  }

  handleWasmDisassemble(args: Record<string, unknown>) {
    return this.conversion.handleWasmDisassemble(args);
  }

  handleWasmDecompile(args: Record<string, unknown>) {
    return this.conversion.handleWasmDecompile(args);
  }

  handleWasmInspectSections(args: Record<string, unknown>) {
    return this.conversion.handleWasmInspectSections(args);
  }

  handleWasmOfflineRun(args: Record<string, unknown>) {
    return this.runtime.handleWasmOfflineRun(args);
  }

  handleWasmOptimize(args: Record<string, unknown>) {
    return this.runtime.handleWasmOptimize(args);
  }

  handleWasmToC(args: Record<string, unknown>) {
    return this.conversion.handleWasmToC(args);
  }

  handleWasmDetectObfuscation(args: Record<string, unknown>) {
    return this.analysis.handleWasmDetectObfuscation(args);
  }

  handleWasmInstrumentTrace(args: Record<string, unknown>) {
    return this.analysis.handleWasmInstrumentTrace(args);
  }
}
