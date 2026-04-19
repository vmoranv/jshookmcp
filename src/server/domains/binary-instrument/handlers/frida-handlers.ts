/**
 * Frida sub-handler — attach, runScript, detach, listSessions, generateScript,
 * enumerateModules, enumerateFunctions, findSymbols.
 */

import { FridaSession } from '@modules/binary-instrument';
import type { BinaryInstrumentState } from './shared';
import {
  readRequiredString,
  readOptionalString,
  parsePid,
  makeMockId,
  jsonResponse,
  textResponse,
  hasInstalledLegacyPlugin,
  invokeLegacyPlugin,
} from './shared';

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
      const sessionId = `mock-frida-${makeMockId(target)}`;
      return jsonResponse({
        available: false,
        target,
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
        sessions: [{ id: sessionId, target, pid: parsePid(target), status: 'unavailable' }],
      });
    }

    const sessionId = await frida.attach(target);
    void this.state.context?.eventBus.emit('frida:attached', {
      target,
      sessionId,
      timestamp: new Date().toISOString(),
    });
    return jsonResponse({
      available: true,
      target,
      sessionId,
      sessions: frida.listSessions(),
    });
  }

  async handleFridaEnumerateModules(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readRequiredString(args, 'sessionId');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return jsonResponse({
        available: false,
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
        modules: [{ name: 'mock-module', base: '0x0', size: 0, path: '<unavailable>' }],
      });
    }

    if (!frida.useSession(sessionId)) {
      return jsonResponse({
        available: false,
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        modules: [],
      });
    }

    const modules = await frida.enumerateModules();
    return jsonResponse({ available: true, sessionId, modules });
  }

  async handleFridaRunScript(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readOptionalString(args, 'sessionId');
    if (!sessionId) return textResponse('Missing required string argument: sessionId');
    const script = readRequiredString(args, 'script');
    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();

    if (!availability.available) {
      return {
        available: false,
        sessionId,
        reason: availability.reason ?? 'Frida CLI is not available',
        execution: { output: '', error: 'Frida unavailable' },
      };
    }

    if (!frida.useSession(sessionId)) {
      return {
        available: false,
        sessionId,
        reason: `Unknown Frida session: ${sessionId}`,
        execution: { output: '', error: 'Unknown session' },
      };
    }

    const execution = await frida.executeScript(script);
    return { available: true, sessionId, execution };
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
    if (hasInstalledLegacyPlugin(this.state.context, 'plugin_frida_bridge') === false) {
      return textResponse('Plugin plugin-frida-bridge is not installed');
    }

    const frida = this.getFridaSession();
    const availability = await frida.getAvailability();
    if (availability.available) {
      const sessions = frida.listSessions();
      return jsonResponse({ success: true, sessions, count: sessions.length });
    }

    return invokeLegacyPlugin(
      this.state.context,
      'plugin_frida_bridge',
      'frida_list_sessions',
      _args,
    );
  }

  async handleFridaGenerateScript(args: Record<string, unknown>): Promise<unknown> {
    if (hasInstalledLegacyPlugin(this.state.context, 'plugin_frida_bridge') === false) {
      return textResponse('Plugin plugin-frida-bridge is not installed');
    }

    const target = readOptionalString(args, 'target') ?? 'unknown';
    const template = readOptionalString(args, 'template') ?? 'trace';
    const functionName = readOptionalString(args, 'functionName') ?? 'target_function';

    const templates = [
      {
        functionName,
        hookCode: `console.log('[${template}] ${functionName} called');`,
        description: `${template} hook for ${functionName}`,
        parameters: [],
      },
    ];

    const script = this.state.hookCodeGenerator.exportScript(templates, 'frida');
    return jsonResponse({ success: true, target, template, functionName, script });
  }

  async handleFridaEnumerateFunctions(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readRequiredString(args, 'sessionId');
    const moduleName = readRequiredString(args, 'moduleName');
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
    return { available: true, sessionId, moduleName, functions, count: functions.length };
  }

  async handleFridaFindSymbols(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = readRequiredString(args, 'sessionId');
    const pattern = readRequiredString(args, 'pattern');
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
    return { available: true, sessionId, pattern, symbols, count: symbols.length };
  }

  private getFridaSession(): FridaSession {
    if (!this.state.fridaSession) {
      this.state.fridaSession = new FridaSession();
    }
    return this.state.fridaSession;
  }
}
