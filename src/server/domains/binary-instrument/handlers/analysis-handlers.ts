/**
 * Static analysis sub-handler — Ghidra, IDA, JADX, Unidbg, hooks, plugins.
 */

import { GhidraAnalyzer, HookGenerator, getAvailablePlugins } from '@modules/binary-instrument';
import { UNIDBG_TIMEOUT_MS } from '@src/constants';
import type { BinaryInstrumentState } from './shared';
import {
  readRequiredString,
  readOptionalString,
  readOptionalNumber,
  readStringArray,
  readHookOptions,
  isRecord,
  isGhidraAnalysisOutput,
  toHookTemplates,
  jsonResponse,
  textResponse,
  getUnidbgAvailability,
  execFileUtf8,
  invokeLegacyPlugin,
} from './shared';

export class AnalysisHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleGhidraAnalyze(args: Record<string, unknown>): Promise<unknown> {
    const legacyTargetPath = readOptionalString(args, 'targetPath');
    const explicitBinaryPath = readOptionalString(args, 'binaryPath');
    if (!explicitBinaryPath && legacyTargetPath) {
      return invokeLegacyPlugin(this.state.context, 'plugin_ghidra_bridge', 'ghidra_analyze', args);
    }

    const binaryPath = readRequiredString(args, 'binaryPath');
    const timeout = readOptionalNumber(args, 'timeout');
    const ghidra = this.getGhidraAnalyzer();
    const availability = await ghidra.getAvailability();
    const analysis = await ghidra.analyze(
      binaryPath,
      timeout !== undefined ? { timeout } : undefined,
    );

    if (!availability.available) {
      return {
        available: false,
        capability: 'ghidra_headless',
        fix: 'Install Ghidra and ensure analyzeHeadless is on PATH.',
        binaryPath,
        reason: availability.reason ?? 'Ghidra analyzeHeadless is not available',
        analysis,
      };
    }

    return { available: true, binaryPath, analysis };
  }

  async handleGhidraDecompile(args: Record<string, unknown>): Promise<unknown> {
    return invokeLegacyPlugin(this.state.context, 'plugin_ghidra_bridge', 'ghidra_decompile', args);
  }

  async handleIdaDecompile(args: Record<string, unknown>): Promise<unknown> {
    return invokeLegacyPlugin(this.state.context, 'plugin_ida_bridge', 'ida_decompile', args);
  }

  async handleJadxDecompile(args: Record<string, unknown>): Promise<unknown> {
    return invokeLegacyPlugin(this.state.context, 'plugin_jadx_bridge', 'jadx_decompile', args);
  }

  async handleGenerateHooks(args: Record<string, unknown>): Promise<unknown> {
    const legacyGhidraOutput = readOptionalString(args, 'ghidraOutput');
    if (legacyGhidraOutput) return this.handleLegacyGenerateHooks(legacyGhidraOutput);

    const legacyGhidraOutputObj = args['ghidraOutput'];
    if (isRecord(legacyGhidraOutputObj)) {
      return this.handleLegacyGenerateHooks(JSON.stringify(legacyGhidraOutputObj));
    }

    const symbols = readStringArray(args, 'symbols');
    if (symbols.length === 0) return textResponse('symbols or ghidraOutput is required');

    const options = readHookOptions(args, 'options');
    const hookGen = this.getHookGenerator();
    const script = hookGen.generateFridaHookScript(symbols, options);
    return jsonResponse({ available: true, symbolCount: symbols.length, script });
  }

  async handleExportHookScript(args: Record<string, unknown>): Promise<unknown> {
    const rawTemplates = readOptionalString(args, 'hookTemplates');
    if (!rawTemplates) {
      const generated = this.state.hookCodeGenerator.exportScript([], 'frida');
      const script = generated.includes('Java.perform')
        ? generated
        : `Java.perform(function() {\n${generated}\n});`;
      return jsonResponse({ format: 'frida', hookCount: 0, script });
    }

    try {
      const parsed = JSON.parse(rawTemplates);
      if (!Array.isArray(parsed)) return textResponse('Invalid JSON');
      const templates = toHookTemplates(parsed);
      const script = this.state.hookCodeGenerator.exportScript(templates, 'frida');
      return jsonResponse({ format: 'frida', hookCount: templates.length, script });
    } catch {
      return textResponse('Invalid JSON');
    }
  }

  async handleUnidbgEmulate(args: Record<string, unknown>): Promise<unknown> {
    const binaryPath = readRequiredString(args, 'binaryPath');
    const functionName = readRequiredString(args, 'functionName');
    const invokeArgs = readStringArray(args, 'args');
    const availability = await getUnidbgAvailability();

    if (!availability.available) {
      return {
        available: false,
        capability: 'unidbg_jar',
        fix: 'Set UNIDBG_JAR to a reachable Unidbg JAR path.',
        binaryPath,
        functionName,
        args: invokeArgs,
        reason: availability.reason,
        result: { returnValue: '0x0', stdout: '', stderr: '', trace: ['mock-unidbg-unavailable'] },
      };
    }

    const result = await execFileUtf8(
      availability.command,
      ['-jar', availability.jarPath, binaryPath, functionName, ...invokeArgs],
      UNIDBG_TIMEOUT_MS,
    );

    return {
      available: true,
      binaryPath,
      functionName,
      args: invokeArgs,
      result: {
        returnValue: '0x0',
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        trace: [],
      },
    };
  }

  async handleUnidbgLaunch(args: Record<string, unknown>): Promise<unknown> {
    const soPath = readOptionalString(args, 'soPath');
    if (!soPath) return textResponse('Missing required string argument: soPath');
    const arch = readOptionalString(args, 'arch') ?? 'arm';

    try {
      const result = await this.state.unidbgRunner.launch(soPath, arch);
      return {
        available: true,
        sessionId: result.sessionId,
        soPath: result.soPath,
        arch: result.arch,
        sessions: this.state.unidbgRunner.listSessions(),
      };
    } catch (error) {
      return {
        available: false,
        capability: 'unidbg_jar',
        fix: 'Set UNIDBG_JAR to a reachable Unidbg JAR path and retry.',
        soPath,
        arch,
        reason: error instanceof Error ? error.message : String(error),
        sessions: this.state.unidbgRunner.listSessions(),
      };
    }
  }

  async handleUnidbgCall(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');
    const functionName = readOptionalString(args, 'functionName');
    if (!functionName) return textResponse('Missing required string argument: functionName');

    const callArgs = isRecord(args['args']) ? (args['args'] as Record<string, unknown>) : {};
    try {
      const result = await this.state.unidbgRunner.callFunction(sessionId, functionName, callArgs);
      return jsonResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResponse(
        message.startsWith('No unidbg session found') ? `${message} (not found)` : message,
      );
    }
  }

  async handleUnidbgTrace(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');

    try {
      const result = await this.state.unidbgRunner.trace(sessionId);
      return jsonResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResponse(
        message.startsWith('No unidbg session found') ? `${message} (not found)` : message,
      );
    }
  }

  async handleGetAvailablePlugins(_args: Record<string, unknown>): Promise<unknown> {
    const plugins = this.state.context ? getAvailablePlugins(this.state.context) : [];
    return jsonResponse({ plugins, count: plugins.length });
  }

  private getGhidraAnalyzer(): GhidraAnalyzer {
    if (!this.state.ghidra) this.state.ghidra = new GhidraAnalyzer();
    return this.state.ghidra;
  }

  private getHookGenerator(): HookGenerator {
    if (!this.state.hookGen) this.state.hookGen = new HookGenerator();
    return this.state.hookGen;
  }

  private handleLegacyGenerateHooks(ghidraOutput: string): Promise<unknown> | unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ghidraOutput);
    } catch {
      return textResponse('Invalid JSON');
    }
    if (!isGhidraAnalysisOutput(parsed)) return textResponse('ghidraOutput is required');
    const hooks = this.state.hookCodeGenerator.generateHooks(parsed);
    return jsonResponse({ count: hooks.length, hooks });
  }
}
