import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import {
  FridaSession,
  GhidraAnalyzer,
  HookCodeGenerator,
  HookGenerator,
  UnidbgRunner,
  getAvailablePlugins,
  invokePlugin,
  type GhidraAnalysisOutput,
  type HookGeneratorOptions,
  type HookParameter,
  type HookTemplate,
} from '@modules/binary-instrument';
import type { MCPServerContext } from '@server/MCPServer.context';

const UNIDBG_TIMEOUT_MS = 30_000;
const UNIDBG_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

interface CommandResult {
  stdout: string;
  stderr: string;
}

export class BinaryInstrumentHandlers {
  private fridaSession?: FridaSession;
  private ghidra?: GhidraAnalyzer;
  private hookGen?: HookGenerator;
  private readonly hookCodeGenerator = new HookCodeGenerator();
  private readonly unidbgRunner = new UnidbgRunner();
  private context?: MCPServerContext;

  constructor(
    first?: FridaSession | MCPServerContext,
    second?: GhidraAnalyzer,
    third?: HookGenerator,
  ) {
    if (first instanceof FridaSession) {
      this.fridaSession = first;
    } else if (this.isServerContext(first)) {
      this.context = first;
    }

    this.ghidra = second;
    this.hookGen = third;
  }

  async handleFridaAttach(args: Record<string, unknown>): Promise<unknown> {
    const legacyPid = this.readOptionalString(args, 'pid');
    const explicitTarget = this.readOptionalString(args, 'target');
    if (!explicitTarget && legacyPid) {
      return this.invokeLegacyPlugin('plugin_frida_bridge', 'frida_attach', args);
    }

    const target = this.readRequiredString(args, 'target');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      const sessionId = `mock-frida-${this.makeMockId(target)}`;
      return this.jsonResponse({
        available: false,
        target,
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
        sessions: [
          {
            id: sessionId,
            target,
            pid: this.parsePid(target),
            status: 'unavailable',
          },
        ],
      });
    }

    const sessionId = await frida.attach(target);
    return this.jsonResponse({
      available: true,
      target,
      sessionId,
      sessions: frida.listSessions(),
    });
  }

  async handleFridaEnumerateModules(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = this.readRequiredString(args, 'sessionId');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return this.jsonResponse({
        available: false,
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
        modules: [
          {
            name: 'mock-module',
            base: '0x0',
            size: 0,
            path: '<unavailable>',
          },
        ],
      });
    }

    if (!frida.useSession(sessionId)) {
      return this.jsonResponse({
        available: false,
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        modules: [],
      });
    }

    const modules = await frida.enumerateModules();
    return this.jsonResponse({
      available: true,
      sessionId,
      modules,
    });
  }

  async handleGhidraAnalyze(args: Record<string, unknown>): Promise<unknown> {
    const legacyTargetPath = this.readOptionalString(args, 'targetPath');
    const explicitBinaryPath = this.readOptionalString(args, 'binaryPath');
    if (!explicitBinaryPath && legacyTargetPath) {
      return this.invokeLegacyPlugin('plugin_ghidra_bridge', 'ghidra_analyze', args);
    }

    const binaryPath = this.readRequiredString(args, 'binaryPath');
    const timeout = this.readOptionalNumber(args, 'timeout');
    const ghidra = this.getGhidraAnalyzer();
    const availability = await ghidra.getAvailability();
    const analysis = await ghidra.analyze(
      binaryPath,
      timeout !== undefined ? { timeout } : undefined,
    );

    if (!availability.available) {
      return {
        available: false,
        binaryPath,
        reason: availability.reason ?? 'Ghidra analyzeHeadless is not available',
        analysis,
      };
    }

    return {
      available: true,
      binaryPath,
      analysis,
    };
  }

  async handleGenerateHooks(args: Record<string, unknown>): Promise<unknown> {
    const legacyGhidraOutput = this.readOptionalString(args, 'ghidraOutput');
    if (legacyGhidraOutput) {
      return this.handleLegacyGenerateHooks(legacyGhidraOutput);
    }

    // Also accept a raw object for ghidraOutput (legacy path)
    const legacyGhidraOutputObj = args['ghidraOutput'];
    if (this.isRecord(legacyGhidraOutputObj)) {
      const serialized = JSON.stringify(legacyGhidraOutputObj);
      return this.handleLegacyGenerateHooks(serialized);
    }

    const symbols = this.readStringArray(args, 'symbols');
    if (symbols.length === 0) {
      return this.textResponse('symbols or ghidraOutput is required');
    }

    const options = this.readHookOptions(args, 'options');
    const hookGen = this.getHookGenerator();
    const script = hookGen.generateFridaHookScript(symbols, options);

    return this.jsonResponse({
      available: true,
      symbolCount: symbols.length,
      script,
    });
  }

  async handleUnidbgEmulate(args: Record<string, unknown>): Promise<unknown> {
    const binaryPath = this.readRequiredString(args, 'binaryPath');
    const functionName = this.readRequiredString(args, 'functionName');
    const invokeArgs = this.readStringArray(args, 'args');
    const availability = await this.getUnidbgAvailability();

    if (!availability.available) {
      return {
        available: false,
        binaryPath,
        functionName,
        args: invokeArgs,
        reason: availability.reason,
        result: {
          returnValue: '0x0',
          stdout: '',
          stderr: '',
          trace: ['mock-unidbg-unavailable'],
        },
      };
    }

    const result = await this.execFileUtf8(
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

  async handleFridaRunScript(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = this.readRequiredString(args, 'sessionId');
    const script = this.readRequiredString(args, 'script');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return {
        available: false,
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
        execution: {
          output: '',
          error: 'Frida unavailable',
        },
      };
    }

    if (!frida.useSession(sessionId)) {
      return {
        available: false,
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        execution: {
          output: '',
          error: 'Unknown session',
        },
      };
    }

    const execution = await frida.executeScript(script);
    return {
      available: true,
      sessionId,
      execution,
    };
  }

  async handleFridaDetach(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = this.readOptionalString(args, 'sessionId');
    if (!sessionId) {
      return this.textResponse('Missing required string argument: sessionId');
    }

    // Native FridaSession fallback
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();
    if (availability.available && frida.hasSession(sessionId)) {
      frida.useSession(sessionId);
      await frida.detach();
      return this.jsonResponse({ success: true, sessionId, detached: true });
    }

    return this.invokeLegacyPlugin('plugin_frida_bridge', 'frida_detach', args);
  }

  async handleFridaListSessions(_args: Record<string, unknown>): Promise<unknown> {
    // Native FridaSession fallback
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();
    if (availability.available) {
      const sessions = frida.listSessions();
      return this.jsonResponse({
        success: true,
        sessions,
        count: sessions.length,
      });
    }

    return this.invokeLegacyPlugin('plugin_frida_bridge', 'frida_list_sessions', _args);
  }

  async handleFridaGenerateScript(args: Record<string, unknown>): Promise<unknown> {
    // Native HookCodeGenerator fallback
    const target = this.readOptionalString(args, 'target') ?? 'unknown';
    const template = this.readOptionalString(args, 'template') ?? 'trace';
    const functionName = this.readOptionalString(args, 'functionName') ?? 'target_function';

    const templates = [
      {
        functionName,
        hookCode: `console.log('[${template}] ${functionName} called');`,
        description: `${template} hook for ${functionName}`,
        parameters: [],
      },
    ];

    const script = this.hookCodeGenerator.exportScript(templates, 'frida');
    return this.jsonResponse({
      success: true,
      target,
      template,
      functionName,
      script,
    });
  }

  async handleGetAvailablePlugins(_args: Record<string, unknown>): Promise<unknown> {
    const plugins = this.context ? getAvailablePlugins(this.context) : [];
    return this.jsonResponse({
      plugins,
      count: plugins.length,
    });
  }

  async handleGhidraDecompile(args: Record<string, unknown>): Promise<unknown> {
    return this.invokeLegacyPlugin('plugin_ghidra_bridge', 'ghidra_decompile', args);
  }

  async handleIdaDecompile(args: Record<string, unknown>): Promise<unknown> {
    return this.invokeLegacyPlugin('plugin_ida_bridge', 'ida_decompile', args);
  }

  async handleJadxDecompile(args: Record<string, unknown>): Promise<unknown> {
    return this.invokeLegacyPlugin('plugin_jadx_bridge', 'jadx_decompile', args);
  }

  async handleUnidbgLaunch(args: Record<string, unknown>): Promise<unknown> {
    const soPath = this.readOptionalString(args, 'soPath');
    if (!soPath) {
      return this.textResponse('soPath is required');
    }

    const arch = this.readOptionalString(args, 'arch') ?? 'arm';

    try {
      const result = await this.unidbgRunner.launch(soPath, arch);
      return {
        available: true,
        sessionId: result.sessionId,
        soPath: result.soPath,
        arch: result.arch,
        sessions: this.unidbgRunner.listSessions(),
      };
    } catch (error) {
      return {
        available: false,
        soPath,
        arch,
        reason: error instanceof Error ? error.message : String(error),
        sessions: this.unidbgRunner.listSessions(),
      };
    }
  }

  async handleUnidbgCall(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = this.readRequiredString(args, 'sessionId');
    const functionName = this.readRequiredString(args, 'functionName');

    const callArgs = this.isRecord(args['args']) ? args['args'] : {};
    try {
      const result = await this.unidbgRunner.callFunction(sessionId, functionName, callArgs);
      return this.jsonResponse(result);
    } catch (error) {
      return this.textResponse(error instanceof Error ? error.message : String(error));
    }
  }

  async handleUnidbgTrace(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = this.readOptionalString(args, 'sessionId');
    if (!sessionId) {
      return this.textResponse('Missing required string argument: sessionId');
    }

    try {
      const result = await this.unidbgRunner.trace(sessionId);
      return this.jsonResponse(result);
    } catch (error) {
      return this.textResponse(error instanceof Error ? error.message : String(error));
    }
  }

  async handleExportHookScript(args: Record<string, unknown>): Promise<unknown> {
    const rawTemplates = this.readOptionalString(args, 'hookTemplates');
    if (!rawTemplates) {
      const script = this.hookCodeGenerator.exportScript([], 'frida');
      return this.jsonResponse({
        format: 'frida',
        hookCount: 0,
        script,
      });
    }

    try {
      const parsed = JSON.parse(rawTemplates);
      if (!Array.isArray(parsed)) {
        return this.textResponse('Invalid JSON');
      }

      const templates = this.toHookTemplates(parsed);
      const script = this.hookCodeGenerator.exportScript(templates, 'frida');
      return this.jsonResponse({
        format: 'frida',
        hookCount: templates.length,
        script,
      });
    } catch {
      return this.textResponse('Invalid JSON');
    }
  }

  async handleFridaEnumerateFunctions(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = this.readRequiredString(args, 'sessionId');
    const moduleName = this.readRequiredString(args, 'moduleName');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return {
        available: false,
        sessionId,
        moduleName,
        reason: availability.reason ?? 'Frida CLI is not available',
        functions: [],
      };
    }

    if (!frida.useSession(sessionId)) {
      return {
        available: false,
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        functions: [],
      };
    }

    const functions = await frida.enumerateFunctions(moduleName);
    return {
      available: true,
      sessionId,
      moduleName,
      functions,
      count: functions.length,
    };
  }

  async handleFridaFindSymbols(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = this.readRequiredString(args, 'sessionId');
    const pattern = this.readRequiredString(args, 'pattern');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return {
        available: false,
        sessionId,
        pattern,
        reason: availability.reason ?? 'Frida CLI is not available',
        symbols: [],
      };
    }

    if (!frida.useSession(sessionId)) {
      return {
        available: false,
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        symbols: [],
      };
    }

    const symbols = await frida.findSymbols(pattern);
    return {
      available: true,
      sessionId,
      pattern,
      symbols,
      count: symbols.length,
    };
  }

  private getFridaSession(): FridaSession {
    if (!this.fridaSession) {
      this.fridaSession = new FridaSession();
    }

    return this.fridaSession;
  }

  private getGhidraAnalyzer(): GhidraAnalyzer {
    if (!this.ghidra) {
      this.ghidra = new GhidraAnalyzer();
    }

    return this.ghidra;
  }

  private getHookGenerator(): HookGenerator {
    if (!this.hookGen) {
      this.hookGen = new HookGenerator();
    }

    return this.hookGen;
  }

  private readRequiredString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${key} is required`);
    }

    return value.trim();
  }

  private readOptionalString(args: Record<string, unknown>, key: string): string | undefined {
    const value = args[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  private readOptionalNumber(args: Record<string, unknown>, key: string): number | undefined {
    const value = args[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private readStringArray(args: Record<string, unknown>, key: string): string[] {
    const value = args[key];
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }

  private readHookOptions(
    args: Record<string, unknown>,
    key: string,
  ): HookGeneratorOptions | undefined {
    const raw = args[key];
    if (!this.isRecord(raw)) {
      return undefined;
    }

    const options: HookGeneratorOptions = {};
    const includeArgs = raw['includeArgs'];
    const includeRetAddr = raw['includeRetAddr'];

    if (typeof includeArgs === 'boolean') {
      options.includeArgs = includeArgs;
    }

    if (typeof includeRetAddr === 'boolean') {
      options.includeRetAddr = includeRetAddr;
    }

    return options;
  }

  private parsePid(target: string): number | null {
    if (!/^\d+$/.test(target)) {
      return null;
    }

    const parsed = Number.parseInt(target, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private makeMockId(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
  }

  private async getUnidbgAvailability(): Promise<{
    available: boolean;
    reason: string;
    command: string;
    jarPath: string;
  }> {
    const jarPath = process.env['UNIDBG_JAR'] ?? '';
    if (jarPath.length === 0) {
      return {
        available: false,
        reason: 'UNIDBG_JAR is not configured',
        command: 'java',
        jarPath: '',
      };
    }

    try {
      await access(jarPath);
    } catch {
      return {
        available: false,
        reason: `UNIDBG_JAR not found: ${jarPath}`,
        command: 'java',
        jarPath,
      };
    }

    return {
      available: true,
      reason: '',
      command: 'java',
      jarPath,
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private isServerContext(value: unknown): value is MCPServerContext {
    return (
      this.isRecord(value) &&
      value['extensionPluginsById'] instanceof Map &&
      value['extensionPluginRuntimeById'] instanceof Map
    );
  }

  private async invokeLegacyPlugin(
    pluginId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.context) {
      return this.textResponse(`Plugin ${pluginId.replaceAll('_', '-')} is not installed`);
    }

    const result = await invokePlugin(this.context, {
      pluginId,
      toolName,
      args,
    });

    if (result.success) {
      return this.jsonResponse(result);
    }

    return this.textResponse(result.error ?? 'Plugin invocation failed');
  }

  private async handleLegacyGenerateHooks(ghidraOutput: string): Promise<unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ghidraOutput);
    } catch {
      return this.textResponse('Invalid JSON');
    }

    if (!this.isGhidraAnalysisOutput(parsed)) {
      return this.textResponse('ghidraOutput is required');
    }

    const hooks = this.hookCodeGenerator.generateHooks(parsed);
    return this.jsonResponse({
      count: hooks.length,
      hooks,
    });
  }

  private isGhidraAnalysisOutput(value: unknown): value is GhidraAnalysisOutput {
    return (
      this.isRecord(value) && Array.isArray(value['functions']) && Array.isArray(value['imports'])
    );
  }

  private toHookTemplates(value: unknown[]): HookTemplate[] {
    const templates: HookTemplate[] = [];
    for (const entry of value) {
      if (!this.isRecord(entry)) {
        continue;
      }

      const functionName = this.readStringRecordField(entry, 'functionName');
      const hookCode = this.readStringRecordField(entry, 'hookCode');
      const description = this.readStringRecordField(entry, 'description');
      const parameters = this.parseHookParameters(entry['parameters']);

      if (!functionName || !hookCode || !description) {
        continue;
      }

      templates.push({
        functionName,
        hookCode,
        description,
        parameters,
      });
    }

    return templates;
  }

  private readStringRecordField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
  }

  private parseHookParameters(value: unknown): HookParameter[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const parameters: HookParameter[] = [];
    for (const entry of value) {
      if (!this.isRecord(entry)) {
        continue;
      }

      const name = this.readStringRecordField(entry, 'name');
      const type = this.readStringRecordField(entry, 'type');
      const description = this.readStringRecordField(entry, 'description');

      if (name && type && description) {
        parameters.push({ name, type, description });
      }
    }

    return parameters;
  }

  private textResponse(text: string): { content: Array<{ type: string; text: string }> } {
    return {
      content: [{ type: 'text', text }],
    };
  }

  private jsonResponse(payload: unknown): { content: Array<{ type: string; text: string }> } {
    return this.textResponse(JSON.stringify(payload));
  }

  private execFileUtf8(file: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: UNIDBG_MAX_BUFFER_BYTES,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
          });
        },
      );
    });
  }
}
