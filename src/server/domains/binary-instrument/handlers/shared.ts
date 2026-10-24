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
  type FridaDevice,
  type GhidraAnalysisOutput,
  type HookGeneratorOptions,
  type HookParameter,
  type HookTemplate,
} from '@modules/binary-instrument';
import type { AndroidRuntimeDumpSessionManager } from '@modules/binary-instrument/android-runtime-dump-session';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { CapabilityStatus } from '@server/domains/shared/capabilities';
import { capabilityFailure } from '@server/domains/shared/capabilities';
import { readEnvString } from '@src/config/environment';
import { killProcessTree, toExecFileCommand } from '@modules/external/WindowsCommand';

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
  androidRuntimeDumpManager?: AndroidRuntimeDumpSessionManager;
  jadxSearchEngine?: import('@modules/jadx-search').JadxSearchEngine;
  context?: MCPServerContext;
}

export function textResponse(text: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

export function jsonResponse(body: unknown): { content: Array<{ type: string; text: string }> } {
  return textResponse(JSON.stringify(body));
}

/**
 * Resolve the device enum (+ host/id) tool args into a FridaDevice.
 *
 * - `undefined` — no device arg was passed; callers apply their own legacy
 *   default (frida_attach/spawn default to local, frida_dex_dump to the usb
 *   boolean for backward compatibility).
 * - `{ error }` — device=remote without host, device=id without id, or an
 *   unknown enum value.
 */
export function resolveFridaDevice(
  args: Record<string, unknown>,
): FridaDevice | { error: string } | undefined {
  const device = readOptionalString(args, 'device');
  if (device === undefined) {
    return undefined;
  }

  switch (device) {
    case 'local':
    case 'usb':
      return { type: device };
    case 'remote': {
      const host = readOptionalString(args, 'host');
      if (!host) {
        return { error: 'host is required when device=remote (e.g. 192.168.1.11:27042)' };
      }
      return { type: 'remote', host };
    }
    case 'id': {
      const id = readOptionalString(args, 'id');
      if (!id) {
        return { error: 'id is required when device=id (see frida_list_devices)' };
      }
      return { type: 'id', id };
    }
    default:
      return { error: `Invalid device: "${device}". Expected one of: local, usb, remote, id` };
  }
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

export function readOptionalBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Duck-type a `Map`: a Map created in ANOTHER JS realm (e.g. inside a
 * `node:vm` context) fails `instanceof Map` yet is fully usable — `has`/`get`
 * work across realms. Accept any object that looks like a Map.
 */
function isMapLike(value: unknown): value is Map<unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Map<unknown, unknown>).has === 'function' &&
    typeof (value as Map<unknown, unknown>).get === 'function'
  );
}

export function isServerContext(value: unknown): value is MCPServerContext {
  return (
    isRecord(value) &&
    isMapLike(value['extensionPluginsById']) &&
    isMapLike(value['extensionPluginRuntimeById'])
  );
}

export function hasInstalledLegacyPlugin(
  context: MCPServerContext | undefined,
  pluginId: string,
): boolean | undefined {
  if (!context) return undefined;
  const installed = context.extensionPluginsById;
  if (!isMapLike(installed)) return undefined;
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
  const jarPath = readEnvString('UNIDBG_JAR', '', { trim: true });
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
    // apktool ships as apktool.bat on Windows, which execFile cannot start without cmd.exe.
    const command = toExecFileCommand(file, args);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const child = execFile(
      command.file,
      command.args,
      {
        windowsHide: true,
        windowsVerbatimArguments: command.windowsVerbatimArguments,
        maxBuffer: UNIDBG_MAX_BUFFER_BYTES,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        settled = true;
        clearTimeout(timer);
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
    // Manual timeout: execFile's own timeout would only kill the cmd.exe wrapper of a batch file
    // and leave its JVM running.
    if (!settled) {
      timer = setTimeout(() => {
        killProcessTree(child);
        reject(new Error(`${file} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
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
