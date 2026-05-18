import { FridaSession, GhidraAnalyzer } from '@modules/binary-instrument';
import { probeCommand } from '@modules/external/ToolProbe';
import { capabilityReport } from '@server/domains/shared/capabilities';
import type { BinaryInstrumentState } from './shared';
import { getLegacyPluginStatus, getUnidbgAvailability, jsonResponse } from './shared';

export class CapabilityHandlers {
  constructor(private readonly state: BinaryInstrumentState) {}

  async handleBinaryInstrumentCapabilities(): Promise<unknown> {
    const [
      fridaAvailability,
      ghidraAvailability,
      jadxAvailability,
      apktoolAvailability,
      unidbgAvailability,
    ] = await Promise.all([
      this.getFridaSession().getAvailability(),
      this.getGhidraAnalyzer().getAvailability(),
      probeCommand('jadx', ['--version']),
      probeCommand('apktool', ['--version']),
      getUnidbgAvailability(),
    ]);

    return jsonResponse(
      capabilityReport('binary_instrument_capabilities', [
        {
          capability: 'frida_cli',
          status: fridaAvailability.available ? 'available' : 'unavailable',
          reason: fridaAvailability.reason,
          fix: fridaAvailability.available
            ? undefined
            : 'Install frida-tools and ensure the frida CLI is on PATH.',
          details: {
            tools: [
              'frida_attach',
              'frida_enumerate_modules',
              'frida_run_script',
              'frida_enumerate_functions',
              'frida_find_symbols',
            ],
            ...(fridaAvailability.path ? { path: fridaAvailability.path } : {}),
            ...(fridaAvailability.version ? { version: fridaAvailability.version } : {}),
          },
        },
        {
          capability: 'plugin_frida_bridge',
          ...getLegacyPluginStatus(this.state.context, 'plugin_frida_bridge'),
          details: {
            tools: ['frida_attach', 'frida_detach', 'frida_list_sessions'],
          },
        },
        {
          capability: 'ghidra_headless',
          status: ghidraAvailability.available ? 'available' : 'unavailable',
          reason: ghidraAvailability.reason,
          fix: ghidraAvailability.available
            ? undefined
            : 'Install Ghidra and ensure analyzeHeadless is on PATH.',
          details: {
            tools: ['ghidra_analyze'],
            ...(ghidraAvailability.path ? { path: ghidraAvailability.path } : {}),
            ...(ghidraAvailability.version ? { version: ghidraAvailability.version } : {}),
          },
        },
        {
          capability: 'plugin_ghidra_bridge',
          ...getLegacyPluginStatus(this.state.context, 'plugin_ghidra_bridge'),
          details: {
            tools: ['ghidra_decompile'],
          },
        },
        {
          capability: 'plugin_ida_bridge',
          ...getLegacyPluginStatus(this.state.context, 'plugin_ida_bridge'),
          details: {
            tools: ['ida_decompile'],
          },
        },
        {
          capability: 'jadx_cli',
          status: jadxAvailability.available ? 'available' : 'unavailable',
          reason: jadxAvailability.reason,
          fix: jadxAvailability.available
            ? undefined
            : 'Install JADX and ensure the jadx CLI is on PATH.',
          details: {
            tools: ['jadx_decompile'],
            ...(jadxAvailability.path ? { path: jadxAvailability.path } : {}),
            ...(jadxAvailability.version ? { version: jadxAvailability.version } : {}),
          },
        },
        {
          capability: 'plugin_jadx_bridge',
          ...getLegacyPluginStatus(this.state.context, 'plugin_jadx_bridge'),
          details: {
            tools: ['jadx_decompile'],
          },
        },
        {
          capability: 'apktool_cli',
          status: apktoolAvailability.available ? 'available' : 'unavailable',
          reason: apktoolAvailability.reason,
          fix: apktoolAvailability.available
            ? undefined
            : 'Install apktool and ensure it is on PATH.',
          details: {
            tools: ['apktool_decode'],
            ...(apktoolAvailability.path ? { path: apktoolAvailability.path } : {}),
            ...(apktoolAvailability.version ? { version: apktoolAvailability.version } : {}),
          },
        },
        {
          capability: 'unidbg_jar',
          status: unidbgAvailability.available ? 'available' : 'unavailable',
          reason: unidbgAvailability.reason || undefined,
          fix: unidbgAvailability.available
            ? undefined
            : 'Set UNIDBG_JAR to a reachable Unidbg JAR path.',
          details: {
            tools: ['unidbg_emulate', 'unidbg_launch', 'unidbg_call', 'unidbg_trace'],
            command: unidbgAvailability.command,
            jarPath: unidbgAvailability.jarPath,
          },
        },
      ]),
    );
  }

  private getFridaSession(): FridaSession {
    if (!this.state.fridaSession) {
      this.state.fridaSession = new FridaSession();
    }
    return this.state.fridaSession;
  }

  private getGhidraAnalyzer(): GhidraAnalyzer {
    if (!this.state.ghidra) {
      this.state.ghidra = new GhidraAnalyzer();
    }
    return this.state.ghidra;
  }
}
