/**
 * Frida sub-handler — attach, spawn, runScript, detach, listSessions, generateScript,
 * enumerateModules, enumerateFunctions, findSymbols.
 */

import { FridaSession } from '@modules/binary-instrument';
import type { BinaryInstrumentState } from './shared';
import {
  readRequiredString,
  readOptionalString,
  readOptionalBoolean,
  jsonResponse,
  textResponse,
  getLegacyPluginStatus,
  invokeLegacyPlugin,
} from './shared';

interface InterceptorArgSpec {
  index: number;
  name: string;
  type: string;
}

interface InterceptorScriptOptions {
  moduleName?: string;
  symbol: string;
  address?: string;
  argSpec: InterceptorArgSpec[];
  onEnterBody?: string;
  onLeaveBody?: string;
}

export class FridaHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleFridaAttach(args: Record<string, unknown>): Promise<unknown> {
    const legacyPid = readOptionalString(args, 'pid');
    const explicitTarget = readOptionalString(args, 'target');
    if (!explicitTarget && legacyPid) {
      return invokeLegacyPlugin(this.state.context, 'plugin_frida_bridge', 'frida_attach', args);
    }

    const target = readRequiredString(args, 'target');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return jsonResponse({
        success: false,
        available: false,
        capability: 'frida_cli',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        target,
        reason: availability.reason ?? 'Frida CLI is not available',
      });
    }

    let sessionId: string;
    try {
      sessionId = await frida.attach(target);
    } catch (error) {
      return jsonResponse({
        success: false,
        available: true,
        capability: 'frida_attach',
        fix: 'Run the server elevated or choose a target process that allows Frida injection.',
        target,
        reason: error instanceof Error ? error.message : String(error),
        sessions: frida.listSessions(),
      });
    }

    void this.state.context?.eventBus.emit('frida:attached', {
      target,
      sessionId,
      timestamp: new Date().toISOString(),
    });
    return jsonResponse({
      success: true,
      available: true,
      target,
      sessionId,
      sessions: frida.listSessions(),
    });
  }

  async handleFridaSpawn(args: Record<string, unknown>): Promise<unknown> {
    const target = readRequiredString(args, 'target');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return jsonResponse({
        success: false,
        available: false,
        capability: 'frida_cli',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        target,
        reason: availability.reason ?? 'Frida CLI is not available',
      });
    }

    let sessionId: string;
    try {
      sessionId = await frida.spawn(target);
    } catch (error) {
      return jsonResponse({
        success: false,
        available: true,
        capability: 'frida_spawn',
        fix: 'Confirm the package or executable exists and that Frida has spawn privileges.',
        target,
        reason: error instanceof Error ? error.message : String(error),
        sessions: frida.listSessions(),
      });
    }

    void this.state.context?.eventBus.emit('frida:spawned', {
      target,
      sessionId,
      timestamp: new Date().toISOString(),
    });
    return jsonResponse({
      success: true,
      available: true,
      target,
      sessionId,
      mode: 'spawn',
      resumed: false,
      sessions: frida.listSessions(),
    });
  }

  async handleFridaEnumerateModules(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readRequiredString(args, 'sessionId');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return jsonResponse({
        success: false,
        available: false,
        capability: 'frida_cli',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
        modules: [],
      });
    }

    if (!frida.useSession(sessionId)) {
      return jsonResponse({
        success: false,
        available: false,
        capability: 'frida_session',
        fix: 'Call frida_attach first and reuse the returned sessionId.',
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        modules: [],
      });
    }

    const modules = await frida.enumerateModules();
    const diagnostics = frida.getSessionDiagnostics(sessionId);
    if (diagnostics?.status === 'error' && diagnostics.lastError) {
      return jsonResponse({
        success: false,
        available: true,
        sessionId,
        reason: diagnostics.lastError,
        modules,
      });
    }

    return jsonResponse({ success: true, available: true, sessionId, modules });
  }

  async handleFridaRunScript(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');
    const script = readRequiredString(args, 'script');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return {
        success: false,
        available: false,
        capability: 'frida_cli',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
        execution: { output: '', error: 'Frida unavailable' },
      };
    }

    if (!frida.useSession(sessionId)) {
      return {
        success: false,
        available: false,
        capability: 'frida_session',
        fix: 'Call frida_attach first and reuse the returned sessionId.',
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        execution: { output: '', error: 'Unknown session' },
      };
    }

    const execution = await frida.executeScript(script);
    if (execution.error) {
      return jsonResponse({
        success: false,
        available: true,
        sessionId,
        reason: execution.error,
        execution,
      });
    }

    return jsonResponse({ success: true, available: true, sessionId, execution });
  }

  async handleFridaResume(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readRequiredString(args, 'sessionId');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return jsonResponse({
        success: false,
        available: false,
        capability: 'frida_cli',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
      });
    }

    if (!frida.useSession(sessionId)) {
      return jsonResponse({
        success: false,
        available: false,
        capability: 'frida_session',
        fix: 'Call frida_spawn first and reuse the returned sessionId.',
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
      });
    }

    const execution = await frida.resume(sessionId);
    if (execution.error) {
      return jsonResponse({
        success: false,
        available: true,
        sessionId,
        resumed: false,
        reason: execution.error,
        execution,
        sessions: frida.listSessions(),
      });
    }

    return jsonResponse({
      success: true,
      available: true,
      sessionId,
      resumed: true,
      execution,
      sessions: frida.listSessions(),
    });
  }

  async handleFridaDetach(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');

    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();
    if (availability.available && frida.hasSession(sessionId)) {
      frida.useSession(sessionId);
      await frida.detach();
      return jsonResponse({ success: true, sessionId, detached: true });
    }

    return invokeLegacyPlugin(this.state.context, 'plugin_frida_bridge', 'frida_detach', args);
  }

  async handleFridaListSessions(_args: Record<string, unknown>): Promise<unknown> {
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();
    const sessions = frida.listSessions();

    if (availability.available) {
      return jsonResponse({ success: true, available: true, sessions, count: sessions.length });
    }

    const pluginStatus = getLegacyPluginStatus(this.state.context, 'plugin_frida_bridge');
    if (sessions.length > 0 || pluginStatus.status === 'unavailable') {
      return jsonResponse({
        success: true,
        available: false,
        capability: 'frida_cli',
        reason: availability.reason ?? 'Frida CLI is not available',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        sessions,
        count: sessions.length,
      });
    }

    return invokeLegacyPlugin(
      this.state.context,
      'plugin_frida_bridge',
      'frida_list_sessions',
      _args,
    );
  }

  async handleFridaGenerateScript(args: Record<string, unknown>): Promise<unknown> {
    const target = readOptionalString(args, 'target') ?? 'unknown';
    const template = readOptionalString(args, 'template') ?? 'trace';
    const functionName = readOptionalString(args, 'functionName') ?? 'target_function';
    const moduleName =
      readOptionalString(args, 'moduleName') ?? (target === 'unknown' ? undefined : target);
    const address = readOptionalString(args, 'address');
    const argSpec = this.readInterceptorArgSpec(args);

    const script = this.buildInterceptorScript({
      moduleName,
      symbol: functionName,
      address,
      argSpec,
      onEnterBody: readOptionalString(args, 'onEnterBody'),
      onLeaveBody: readOptionalString(args, 'onLeaveBody'),
    });

    return jsonResponse({
      success: true,
      target,
      template,
      functionName,
      moduleName,
      address,
      argSpec,
      script,
    });
  }

  async handleFridaAttachInterceptor(args: Record<string, unknown>): Promise<unknown> {
    const symbol = readRequiredString(args, 'symbol');
    const moduleName = readOptionalString(args, 'moduleName');
    const address = readOptionalString(args, 'address');
    const sessionId = readOptionalString(args, 'sessionId');
    const install = readOptionalBoolean(args, 'install') ?? false;
    const argSpec = this.readInterceptorArgSpec(args);
    const script = this.buildInterceptorScript({
      moduleName,
      symbol,
      address,
      argSpec,
      onEnterBody: readOptionalString(args, 'onEnterBody'),
      onLeaveBody: readOptionalString(args, 'onLeaveBody'),
    });

    if (!install) {
      return jsonResponse({
        success: true,
        installed: false,
        moduleName,
        symbol,
        address,
        argSpec,
        script,
      });
    }

    if (!sessionId) {
      return textResponse('Missing required string argument: sessionId');
    }

    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();
    if (!availability.available) {
      return jsonResponse({
        success: false,
        available: false,
        capability: 'frida_cli',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        sessionId,
        moduleName,
        symbol,
        reason: availability.reason ?? 'Frida CLI is not available',
        script,
      });
    }

    if (!frida.useSession(sessionId)) {
      return jsonResponse({
        success: false,
        available: false,
        capability: 'frida_session',
        fix: 'Call frida_attach or frida_spawn first and reuse the returned sessionId.',
        sessionId,
        moduleName,
        symbol,
        reason: `Unknown Frida session: ${sessionId}`,
        script,
      });
    }

    const execution = await frida.executeScript(script);
    if (execution.error) {
      return jsonResponse({
        success: false,
        available: true,
        installed: false,
        sessionId,
        moduleName,
        symbol,
        reason: execution.error,
        execution,
        script,
      });
    }

    return jsonResponse({
      success: true,
      available: true,
      installed: true,
      sessionId,
      moduleName,
      symbol,
      execution,
      script,
    });
  }

  async handleFridaEnumerateFunctions(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readRequiredString(args, 'sessionId');
    const moduleName = readRequiredString(args, 'moduleName');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return {
        success: false,
        available: false,
        capability: 'frida_cli',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        sessionId,
        moduleName,
        reason: availability.reason ?? 'Frida CLI is not available',
        functions: [],
      };
    }

    if (!frida.useSession(sessionId)) {
      return {
        success: false,
        available: false,
        capability: 'frida_session',
        fix: 'Call frida_attach first and reuse the returned sessionId.',
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        functions: [],
      };
    }

    const functions = await frida.enumerateFunctions(moduleName);
    const diagnostics = frida.getSessionDiagnostics(sessionId);
    if (diagnostics?.status === 'error' && diagnostics.lastError) {
      return jsonResponse({
        success: false,
        available: true,
        sessionId,
        moduleName,
        reason: diagnostics.lastError,
        functions,
        count: functions.length,
      });
    }

    return jsonResponse({
      success: true,
      available: true,
      sessionId,
      moduleName,
      functions,
      count: functions.length,
    });
  }

  async handleFridaFindSymbols(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readRequiredString(args, 'sessionId');
    const pattern = readRequiredString(args, 'pattern');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return {
        success: false,
        available: false,
        capability: 'frida_cli',
        fix: 'Install frida-tools and ensure the frida CLI is on PATH.',
        sessionId,
        pattern,
        reason: availability.reason ?? 'Frida CLI is not available',
        symbols: [],
      };
    }

    if (!frida.useSession(sessionId)) {
      return {
        success: false,
        available: false,
        capability: 'frida_session',
        fix: 'Call frida_attach first and reuse the returned sessionId.',
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        symbols: [],
      };
    }

    const symbols = await frida.findSymbols(pattern);
    const diagnostics = frida.getSessionDiagnostics(sessionId);
    if (diagnostics?.status === 'error' && diagnostics.lastError) {
      return jsonResponse({
        success: false,
        available: true,
        sessionId,
        pattern,
        reason: diagnostics.lastError,
        symbols,
        count: symbols.length,
      });
    }

    return jsonResponse({
      success: true,
      available: true,
      sessionId,
      pattern,
      symbols,
      count: symbols.length,
    });
  }

  private buildInterceptorScript(options: InterceptorScriptOptions): string {
    const targetExpression = options.address
      ? `ptr(${JSON.stringify(options.address)})`
      : `Module.findExportByName(${options.moduleName ? JSON.stringify(options.moduleName) : 'null'}, ${JSON.stringify(options.symbol)})`;
    const argLines = options.argSpec.map(
      (arg) =>
        `    console.log('[arg] ${arg.name}=' + __jshookReadArg(args, ${arg.index}, ${JSON.stringify(arg.type)}));`,
    );
    const onEnterBody = this.indentScriptBody(options.onEnterBody, 4);
    const onLeaveBody = this.indentScriptBody(options.onLeaveBody, 4);

    return [
      "'use strict';",
      `const targetName = ${JSON.stringify(options.symbol)};`,
      `const targetAddress = ${targetExpression};`,
      'if (targetAddress === null) {',
      "  throw new Error('Unable to resolve Frida export: ' + targetName);",
      '}',
      'function __jshookReadArg(args, index, type) {',
      '  const value = args[index];',
      '  try {',
      '    switch (type) {',
      "      case 'int':",
      '        return value.toInt32();',
      "      case 'uint':",
      '        return value.toUInt32();',
      "      case 'string':",
      "      case 'cstring':",
      "      case 'utf8':",
      '        return Memory.readUtf8String(value);',
      "      case 'pointer':",
      '      default:',
      '        return String(value);',
      '    }',
      '  } catch (error) {',
      "    return '<read-error:' + error.message + '>';",
      '  }',
      '}',
      'Interceptor.attach(targetAddress, {',
      '  onEnter(args) {',
      "    console.log('[enter] ' + targetName + ' @ ' + targetAddress);",
      ...argLines,
      ...(onEnterBody ? [onEnterBody] : []),
      '  },',
      '  onLeave(retval) {',
      "    console.log('[leave] ' + targetName + ' => ' + retval);",
      ...(onLeaveBody ? [onLeaveBody] : []),
      '  },',
      '});',
      '',
    ].join('\n');
  }

  private readInterceptorArgSpec(args: Record<string, unknown>): InterceptorArgSpec[] {
    const value = args['argSpec'];
    if (!Array.isArray(value)) {
      return [];
    }

    const specs: InterceptorArgSpec[] = [];
    for (const [fallbackIndex, entry] of value.entries()) {
      if (!this.isRecord(entry)) {
        continue;
      }

      const index = this.readFiniteInteger(entry['index']) ?? fallbackIndex;
      const rawName = typeof entry['name'] === 'string' ? entry['name'].trim() : '';
      const rawType = typeof entry['type'] === 'string' ? entry['type'].trim() : '';
      specs.push({
        index,
        name: rawName || `arg${index}`,
        type: rawType || 'pointer',
      });
    }

    return specs;
  }

  private indentScriptBody(body: string | undefined, spaces: number): string | undefined {
    const trimmed = body?.trim();
    if (!trimmed) {
      return undefined;
    }

    const indent = ' '.repeat(spaces);
    return trimmed
      .split(/\r?\n/)
      .map((line) => `${indent}${line}`)
      .join('\n');
  }

  private readFiniteInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private getFridaSession(): FridaSession {
    if (!this.state.fridaSession) {
      this.state.fridaSession = new FridaSession();
    }
    return this.state.fridaSession;
  }
}
