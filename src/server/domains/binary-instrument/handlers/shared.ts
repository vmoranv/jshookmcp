/**
 * Shared types and helpers for binary-instrument sub-handlers.
 */

import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import {
  FridaSession,
  GhidraAnalyzer,
  HookCodeGenerator,
  HookGenerator,
  UnidbgRunner,
  invokePlugin,
  type GhidraAnalysisOutput,
  type HookGeneratorOptions,
  type HookParameter,
  type HookTemplate,
} from '@modules/binary-instrument';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { CapabilityStatus } from '@server/domains/shared/capabilities';
import { capabilityFailure } from '@server/domains/shared/capabilities';

const UNIDBG_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const LEGACY_PLUGIN_FIXES: Record<string, string> = {
  plugin_frida_bridge: 'Install @jshookmcpextension/plugin-frida-bridge and reload extensions.',
  plugin_ghidra_bridge: 'Install @jshookmcpextension/plugin-ghidra-bridge and reload extensions.',
  plugin_ida_bridge: 'Install @jshookmcpextension/plugin-ida-bridge and reload extensions.',
  plugin_jadx_bridge: 'Install @jshookmcpextension/plugin-jadx-bridge and reload extensions.',
};

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface BinaryInstrumentState {
  fridaSession?: FridaSession;
  ghidra?: GhidraAnalyzer;
  hookGen?: HookGenerator;
  hookCodeGenerator: HookCodeGenerator;
  unidbgRunner: UnidbgRunner;
  context?: MCPServerContext;
}

export function textResponse(text: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

export function jsonResponse(payload: unknown): { content: Array<{ type: string; text: string }> } {
  return textResponse(JSON.stringify(payload));
}

export function readRequiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function readOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function readOptionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isServerContext(value: unknown): value is MCPServerContext {
  return (
    isRecord(value) &&
    value['extensionPluginsById'] instanceof Map &&
    value['extensionPluginRuntimeById'] instanceof Map
  );
}

export function hasInstalledLegacyPlugin(
  context: MCPServerContext | undefined,
  pluginId: string,
): boolean | undefined {
  if (!context) return undefined;
  const installed = context.extensionPluginsById;
  if (!(installed instanceof Map)) return undefined;
  return installed.has(pluginId);
}

export function getLegacyPluginFix(pluginId: string): string | undefined {
  return LEGACY_PLUGIN_FIXES[pluginId];
}

export function getLegacyPluginStatus(
  context: MCPServerContext | undefined,
  pluginId: string,
): {
  status: CapabilityStatus;
  reason?: string;
  fix?: string;
} {
  const installed = hasInstalledLegacyPlugin(context, pluginId);
  if (installed === true) {
    return {
      status: 'available',
      fix: getLegacyPluginFix(pluginId),
    };
  }
  if (installed === false) {
    return {
      status: 'unavailable',
      reason: `Plugin ${pluginId.replaceAll('_', '-')} is not installed`,
      fix: getLegacyPluginFix(pluginId),
    };
  }
  return {
    status: 'unknown',
    reason: 'Extension plugin registry is not available in the current server context',
    fix: 'Run inside the full MCP server with extension support enabled.',
  };
}

export async function invokeLegacyPlugin(
  context: MCPServerContext | undefined,
  pluginId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const pluginStatus = getLegacyPluginStatus(context, pluginId);
  if (!context || pluginStatus.status !== 'available') {
    return jsonResponse({
      ...capabilityFailure(
        toolName,
        pluginId,
        pluginStatus.reason ?? `Plugin ${pluginId.replaceAll('_', '-')} is not available`,
        pluginStatus.fix,
      ),
      status: pluginStatus.status,
    });
  }

  const result = await invokePlugin(context, { pluginId, toolName, args });
  if (result.success) return jsonResponse(result);
  return jsonResponse({
    ...capabilityFailure(
      toolName,
      pluginId,
      result.error ?? 'Plugin invocation failed',
      pluginStatus.fix,
    ),
  });
}

export function readHookOptions(
  args: Record<string, unknown>,
  key: string,
): HookGeneratorOptions | undefined {
  const raw = args[key];
  if (!isRecord(raw)) return undefined;

  const options: HookGeneratorOptions = {};
  const includeArgs = raw['includeArgs'];
  const includeRetAddr = raw['includeRetAddr'];

  if (typeof includeArgs === 'boolean') options.includeArgs = includeArgs;
  if (typeof includeRetAddr === 'boolean') options.includeRetAddr = includeRetAddr;

  return options;
}

export function parsePid(target: string): number | null {
  if (!/^\d+$/.test(target)) return null;
  const parsed = Number.parseInt(target, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function makeMockId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

export async function getUnidbgAvailability(): Promise<{
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
  return { available: true, reason: '', command: 'java', jarPath };
}

export function execFileUtf8(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
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

export function isGhidraAnalysisOutput(value: unknown): value is GhidraAnalysisOutput {
  return isRecord(value) && Array.isArray(value['functions']) && Array.isArray(value['imports']);
}

export function toHookTemplates(value: unknown[]): HookTemplate[] {
  const templates: HookTemplate[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const functionName = readStringRecordField(entry, 'functionName');
    const hookCode = readStringRecordField(entry, 'hookCode');
    const description = readStringRecordField(entry, 'description');
    const parameters = parseHookParameters(entry['parameters']);
    if (!functionName || !hookCode || !description) continue;
    templates.push({ functionName, hookCode, description, parameters });
  }
  return templates;
}

function readStringRecordField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function parseHookParameters(value: unknown): HookParameter[] {
  if (!Array.isArray(value)) return [];
  const parameters: HookParameter[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const name = readStringRecordField(entry, 'name');
    const type = readStringRecordField(entry, 'type');
    const description = readStringRecordField(entry, 'description');
    if (name && type && description) parameters.push({ name, type, description });
  }
  return parameters;
}
