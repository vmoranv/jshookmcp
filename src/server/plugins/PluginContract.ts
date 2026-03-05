/**
 * Plugin system contract for jshookmcp.
 *
 * Plugins extend the server by contributing domains, workflows, config defaults,
 * and metrics through a standardized lifecycle.
 *
 * Lifecycle: load → validate → register → activate → deactivate → unload
 */
import type { DomainManifest, ToolProfileId } from '../registry/contracts.js';
import type { WorkflowContract } from '../workflows/WorkflowContract.js';
import type { ToolArgs, ToolResponse } from '../types.js';

/* ---------- Plugin state ---------- */

export type PluginState =
  | 'loaded'
  | 'validated'
  | 'registered'
  | 'activated'
  | 'deactivated'
  | 'unloaded';

export const PluginLifecycleOrder: PluginState[] = [
  'loaded',
  'validated',
  'registered',
  'activated',
  'deactivated',
  'unloaded',
];

/* ---------- Permissions ---------- */

export interface PluginPermission {
  /** Allowed outbound network hosts (empty = no network). */
  network?: {
    allowHosts: string[];
  };
  /** Allowed subprocess commands (empty = no subprocesses). */
  process?: {
    allowCommands: string[];
  };
  /** Filesystem access roots (empty = no filesystem). */
  filesystem?: {
    readRoots: string[];
    writeRoots: string[];
  };
  /** Which MCP tools this plugin is allowed to invoke. */
  toolExecution?: {
    /** Allowlist for PluginLifecycleContext.invokeTool(). */
    allowTools: string[];
  };
}

/* ---------- Activation policy ---------- */

export interface PluginActivationPolicy {
  /** Auto-activate when server starts with these profiles. */
  profiles?: ToolProfileId[];
  /** Activate only if these env vars are set. */
  envFlags?: string[];
  /** Activate on startup (default: false). */
  onStartup?: boolean;
}

/* ---------- Contributions ---------- */

export interface PluginContributes {
  /** Standard DomainManifests contributed by this plugin. */
  domains?: DomainManifest[];
  /** Workflow templates contributed by this plugin. */
  workflows?: WorkflowContract[];
  /** Default config values merged into runtime config. */
  configDefaults?: Record<string, unknown>;
  /** Metric names this plugin will emit. */
  metrics?: string[];
}

/* ---------- Plugin manifest ---------- */

export interface PluginManifest {
  readonly kind: 'plugin-manifest';
  readonly version: 1;
  /** Reverse-domain format, e.g. 'com.example.my-plugin'. */
  readonly id: string;
  readonly name: string;
  /** semver */
  readonly pluginVersion: string;
  /** Relative to plugin root. */
  readonly entry: string;
  readonly description?: string;
  /** semver range for core compatibility. */
  readonly compatibleCore: string;
  /** Undeclared capabilities are denied. */
  readonly permissions: PluginPermission;
  readonly activation?: PluginActivationPolicy;
  readonly contributes?: PluginContributes;
  /** SHA-256 */
  readonly checksum?: string;
  readonly signature?: string;
}

/* ---------- Validation result ---------- */

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export function defaultValidationResult(): PluginValidationResult {
  return { valid: true, errors: [] };
}

/* ---------- Lifecycle context ---------- */

export interface PluginLifecycleContext {
  readonly pluginId: string;
  readonly pluginRoot: string;
  readonly config: Record<string, unknown>;
  readonly state: PluginState;

  registerDomain(manifest: DomainManifest): void;
  registerWorkflow(workflow: WorkflowContract): void;
  registerMetric(metricName: string): void;
  /**
   * Invoke a built-in tool through the server router.
   * Access is constrained by permissions.toolExecution.allowTools.
   */
  invokeTool(name: string, args?: ToolArgs): Promise<ToolResponse>;

  hasPermission(capability: keyof PluginPermission): boolean;
  getConfig<T = unknown>(path: string, fallback?: T): T;
  setRuntimeData(key: string, value: unknown): void;
  getRuntimeData<T = unknown>(key: string): T | undefined;
}

/* ---------- Plugin contract ---------- */

export interface PluginContract {
  readonly manifest: PluginManifest;

  /** Called when the plugin is first loaded. */
  onLoad(ctx: PluginLifecycleContext): Promise<void> | void;
  /** Validate plugin configuration and environment. */
  onValidate?(ctx: PluginLifecycleContext): Promise<PluginValidationResult> | PluginValidationResult;
  /** Register contributed domains, workflows, config. */
  onRegister?(ctx: PluginLifecycleContext): Promise<void> | void;
  /** Plugin becomes active — tools are available. */
  onActivate?(ctx: PluginLifecycleContext): Promise<void> | void;
  /** Plugin is deactivated — tools removed but state preserved. */
  onDeactivate?(ctx: PluginLifecycleContext): Promise<void> | void;
  /** Plugin is fully unloaded — release all resources. */
  onUnload?(ctx: PluginLifecycleContext): Promise<void> | void;
}

/* ---------- Helpers ---------- */

export function isValidLifecycleTransition(from: PluginState, to: PluginState): boolean {
  const idxFrom = PluginLifecycleOrder.indexOf(from);
  const idxTo = PluginLifecycleOrder.indexOf(to);
  // Normal forward transition or activated → deactivated
  return idxTo === idxFrom + 1 || (from === 'activated' && to === 'deactivated');
}
