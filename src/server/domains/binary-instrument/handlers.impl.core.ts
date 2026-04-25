/**
 * BinaryInstrument domain — composition facade.
 *
 * Frida operations in ./handlers/frida-handlers.ts.
 * Analysis/unidbg/hook operations in ./handlers/analysis-handlers.ts.
 */

import {
  FridaSession,
  GhidraAnalyzer,
  HookCodeGenerator,
  HookGenerator,
  UnidbgRunner,
} from '@modules/binary-instrument';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { BinaryInstrumentState } from './handlers/shared';
import { isServerContext } from './handlers/shared';
import { FridaHandlers } from './handlers/frida-handlers';
import { AnalysisHandlers } from './handlers/analysis-handlers';
import { CapabilityHandlers } from './handlers/capability-handlers';

export class BinaryInstrumentHandlers {
  private state: BinaryInstrumentState;
  private frida: FridaHandlers;
  private analysis: AnalysisHandlers;
  private capabilities: CapabilityHandlers;

  constructor(
    first?: FridaSession | MCPServerContext,
    second?: GhidraAnalyzer,
    third?: HookGenerator,
  ) {
    this.state = {
      hookCodeGenerator: new HookCodeGenerator(),
      unidbgRunner: new UnidbgRunner(),
    };

    if (first instanceof FridaSession) {
      this.state.fridaSession = first;
    } else if (isServerContext(first)) {
      this.state.context = first;
    }

    if (second) this.state.ghidra = second;
    if (third) this.state.hookGen = third;

    this.frida = new FridaHandlers(this.state);
    this.analysis = new AnalysisHandlers(this.state);
    this.capabilities = new CapabilityHandlers(this.state);
  }

  handleBinaryInstrumentCapabilities() {
    return this.capabilities.handleBinaryInstrumentCapabilities();
  }
  handleFridaAttach(args: Record<string, unknown>) {
    return this.frida.handleFridaAttach(args);
  }
  handleFridaEnumerateModules(args: Record<string, unknown>) {
    return this.frida.handleFridaEnumerateModules(args);
  }
  handleFridaRunScript(args: Record<string, unknown>) {
    return this.frida.handleFridaRunScript(args);
  }
  handleFridaDetach(args: Record<string, unknown>) {
    return this.frida.handleFridaDetach(args);
  }
  handleFridaListSessions(args: Record<string, unknown>) {
    return this.frida.handleFridaListSessions(args);
  }
  handleFridaGenerateScript(args: Record<string, unknown>) {
    return this.frida.handleFridaGenerateScript(args);
  }
  handleFridaEnumerateFunctions(args: Record<string, unknown>) {
    return this.frida.handleFridaEnumerateFunctions(args);
  }
  handleFridaFindSymbols(args: Record<string, unknown>) {
    return this.frida.handleFridaFindSymbols(args);
  }
  handleGhidraAnalyze(args: Record<string, unknown>) {
    return this.analysis.handleGhidraAnalyze(args);
  }
  handleGhidraDecompile(args: Record<string, unknown>) {
    return this.analysis.handleGhidraDecompile(args);
  }
  handleIdaDecompile(args: Record<string, unknown>) {
    return this.analysis.handleIdaDecompile(args);
  }
  handleJadxDecompile(args: Record<string, unknown>) {
    return this.analysis.handleJadxDecompile(args);
  }
  handleGenerateHooks(args: Record<string, unknown>) {
    return this.analysis.handleGenerateHooks(args);
  }
  handleExportHookScript(args: Record<string, unknown>) {
    return this.analysis.handleExportHookScript(args);
  }
  handleUnidbgEmulate(args: Record<string, unknown>) {
    return this.analysis.handleUnidbgEmulate(args);
  }
  handleUnidbgLaunch(args: Record<string, unknown>) {
    return this.analysis.handleUnidbgLaunch(args);
  }
  handleUnidbgCall(args: Record<string, unknown>) {
    return this.analysis.handleUnidbgCall(args);
  }
  handleUnidbgTrace(args: Record<string, unknown>) {
    return this.analysis.handleUnidbgTrace(args);
  }
  handleGetAvailablePlugins(args: Record<string, unknown>) {
    return this.analysis.handleGetAvailablePlugins(args);
  }
}
