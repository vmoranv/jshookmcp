import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ToolProfileId = 'search' | 'minimal' | 'workflow' | 'full';
export type ToolArgs = Record<string, unknown>;
export type ToolResponse = CallToolResult;

export interface ToolHandlerDeps {
  readonly [depKey: string]: unknown;
}

export interface ToolRegistration {
  readonly tool: Tool;
  readonly domain: string;
  readonly bind: (deps: ToolHandlerDeps) => (args: ToolArgs) => Promise<unknown>;
}

export interface DomainManifest<
  TDepKey extends string = string,
  THandler = unknown,
  TDomain extends string = string,
> {
  readonly kind: 'domain-manifest';
  readonly version: 1;
  readonly domain: TDomain;
  readonly depKey: TDepKey;
  readonly profiles: readonly ToolProfileId[];
  readonly registrations: readonly ToolRegistration[];
  readonly ensure: (ctx: unknown) => THandler;
}

export type PluginState =
  | 'loaded'
  | 'validated'
  | 'registered'
  | 'activated'
  | 'deactivated'
  | 'unloaded';

export interface PluginPermission {
  network?: {
    allowHosts: string[];
  };
  process?: {
    allowCommands: string[];
  };
  filesystem?: {
    readRoots: string[];
    writeRoots: string[];
  };
  toolExecution?: {
    allowTools: string[];
  };
}

export interface PluginActivationPolicy {
  profiles?: ToolProfileId[];
  envFlags?: string[];
  onStartup?: boolean;
}

export interface PluginContributes {
  domains?: DomainManifest[];
  workflows?: unknown[];
  configDefaults?: Record<string, unknown>;
  metrics?: string[];
}

export interface PluginManifest {
  readonly kind: 'plugin-manifest';
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly pluginVersion: string;
  readonly entry: string;
  readonly description?: string;
  readonly compatibleCore: string;
  readonly permissions: PluginPermission;
  readonly activation?: PluginActivationPolicy;
  readonly contributes?: PluginContributes;
  readonly checksum?: string;
  readonly signature?: string;
}

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface PluginLifecycleContext {
  readonly pluginId: string;
  readonly pluginRoot: string;
  readonly config: Record<string, unknown>;
  readonly state: PluginState;
  registerDomain(manifest: DomainManifest): void;
  registerWorkflow(workflow: unknown): void;
  registerMetric(metricName: string): void;
  invokeTool(name: string, args?: ToolArgs): Promise<ToolResponse>;
  hasPermission(capability: keyof PluginPermission): boolean;
  getConfig<T = unknown>(path: string, fallback?: T): T;
  setRuntimeData(key: string, value: unknown): void;
  getRuntimeData<T = unknown>(key: string): T | undefined;
}

export interface PluginContract {
  readonly manifest: PluginManifest;
  onLoad(ctx: PluginLifecycleContext): Promise<void> | void;
  onValidate?(
    ctx: PluginLifecycleContext,
  ): Promise<PluginValidationResult> | PluginValidationResult;
  onRegister?(ctx: PluginLifecycleContext): Promise<void> | void;
  onActivate?(ctx: PluginLifecycleContext): Promise<void> | void;
  onDeactivate?(ctx: PluginLifecycleContext): Promise<void> | void;
  onUnload?(ctx: PluginLifecycleContext): Promise<void> | void;
}

const loadedEnvPaths = new Set<string>();

export function loadPluginEnv(manifestUrl: string): void {
  const pluginDir = dirname(fileURLToPath(manifestUrl));
  const envPath = join(pluginDir, '.env');

  if (loadedEnvPaths.has(envPath)) return;
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
  loadedEnvPaths.add(envPath);
}

function normalizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function envCandidates(pluginId: string, key: string): string[] {
  const pluginSegment = normalizeSegment(pluginId);
  const keySegment = normalizeSegment(key);
  return [
    `PLUGIN_${pluginSegment}_${keySegment}`,
    `PLUGINS_${pluginSegment}_${keySegment}`,
  ];
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return undefined;
}

export function getPluginBooleanConfig(
  ctx: Pick<PluginLifecycleContext, 'getConfig'>,
  pluginId: string,
  key: string,
  fallback: boolean,
): boolean {
  for (const candidate of envCandidates(pluginId, key)) {
    const parsed = parseBoolean(process.env[candidate]);
    if (parsed !== undefined) return parsed;
  }

  return ctx.getConfig<boolean>(`plugins.${pluginId}.${key}`, fallback);
}

const VALID_BOOST_TIERS = new Set<ToolProfileId>([
  'search',
  'minimal',
  'workflow',
  'full',
]);

export function getPluginBoostTier(pluginId: string): ToolProfileId {
  for (const candidate of envCandidates(pluginId, 'BOOST_DOMAIN')) {
    const raw = process.env[candidate]?.trim().toLowerCase() as ToolProfileId | undefined;
    if (raw && VALID_BOOST_TIERS.has(raw)) return raw;
  }

  const globalDefault = process.env.MCP_DEFAULT_PLUGIN_BOOST_TIER?.trim().toLowerCase() as
    | ToolProfileId
    | undefined;
  if (globalDefault && VALID_BOOST_TIERS.has(globalDefault)) return globalDefault;

  return 'full';
}
