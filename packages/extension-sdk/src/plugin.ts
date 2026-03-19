
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  toTextResponse,
  toErrorResponse,
} from '@extension-sdk/bridges/shared';

export type ToolProfileId = 'search' | 'workflow' | 'full';
export type ToolArgs = Record<string, unknown>;
export type ToolResponse = CallToolResult;

export type PluginState =
  | 'loaded'
  | 'validated'
  | 'registered'
  | 'activated'
  | 'deactivated'
  | 'unloaded';

export interface PluginLifecycleContext {
  readonly pluginId: string;
  readonly pluginRoot: string;
  readonly config: Record<string, unknown>;
  readonly state: PluginState;
  registerMetric(metricName: string): void;
  invokeTool(name: string, args?: ToolArgs): Promise<ToolResponse>;
  /**
   * Check whether the plugin has a given capability.
   *
   * @experimental Currently always returns `true`. A fine-grained permission
   * model is planned for a future release — call sites should still guard on
   * the return value so they work correctly once enforcement is enabled.
   */
  hasPermission(capability: string): boolean;
  getConfig<T = unknown>(path: string, fallback?: T): T;
  setRuntimeData(key: string, value: unknown): void;
  getRuntimeData<T = unknown>(key: string): T | undefined;
}

export type ExtensionToolHandler = (args: ToolArgs, ctx: PluginLifecycleContext) => Promise<ToolResponse>;

export interface ExtensionToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: ExtensionToolHandler;
  /** Profile tiers this tool should be available in (default: ['full']). */
  profiles?: ToolProfileId[];
}

// ── Response helpers (delegates to bridge) ──

/** Build a success JSON response for an MCP tool. Alias of `toTextResponse`. */
export const jsonResponse: (payload: Record<string, unknown>) => ToolResponse = toTextResponse;

/** Build an error JSON response for an MCP tool. Alias of `toErrorResponse`. */
export const errorResponse: (
  tool: string,
  error: unknown,
  extra?: Record<string, unknown>,
) => ToolResponse = toErrorResponse;

// ── ExtensionBuilder ──

export class ExtensionBuilder {
  // ── state ──
  private readonly _id: string;
  private readonly _version: string;
  private _name: string = '';
  private _description: string = '';
  private _author: string = '';
  private _sourceRepo: string = '';
  private _compatibleCore: string = '>=0.1.0';
  private _profiles: ToolProfileId[] = ['full'];
  private _tools: ExtensionToolDefinition[] = [];
  private _allowCommands: string[] = [];
  private _allowHosts: string[] = [];
  private _allowTools: string[] = [];
  private _metrics: string[] = [];
  private _configDefaults: Record<string, unknown> = {};
  private _onLoadHandler?: (ctx: PluginLifecycleContext) => Promise<void> | void;
  private _onValidateHandler?: (ctx: PluginLifecycleContext) => Promise<{valid: boolean; errors: string[]}> | {valid: boolean; errors: string[]};
  private _onActivateHandler?: (ctx: PluginLifecycleContext) => Promise<void> | void;
  private _onDeactivateHandler?: (ctx: PluginLifecycleContext) => Promise<void> | void;

  constructor(id: string, version: string) {
    this._id = id;
    this._version = version;
  }

  // ── accessors ──

  get id(): string { return this._id; }
  get version(): string { return this._version; }
  get pluginName(): string { return this._name; }
  get pluginDescription(): string { return this._description; }
  get pluginAuthor(): string { return this._author; }
  get pluginSourceRepo(): string { return this._sourceRepo; }
  get compatibleCoreRange(): string { return this._compatibleCore; }
  get profiles(): ToolProfileId[] { return this._profiles; }
  get tools(): ExtensionToolDefinition[] { return this._tools; }
  get allowedCommands(): string[] { return this._allowCommands; }
  get allowedHosts(): string[] { return this._allowHosts; }
  get allowedTools(): string[] { return this._allowTools; }
  get declaredMetrics(): string[] { return this._metrics; }
  get configDefaults(): Record<string, unknown> { return this._configDefaults; }
  get onLoadHandler() { return this._onLoadHandler; }
  get onValidateHandler() { return this._onValidateHandler; }
  get onActivateHandler() { return this._onActivateHandler; }
  get onDeactivateHandler() { return this._onDeactivateHandler; }

  // ── setters ──

  name(n: string): this { this._name = n; return this; }
  description(desc: string): this { this._description = desc; return this; }
  author(a: string): this { this._author = a; return this; }
  sourceRepo(url: string): this { this._sourceRepo = url; return this; }
  compatibleCore(range: string): this { this._compatibleCore = range; return this; }

  /**
   * Merge external metadata (e.g. from meta.yaml) into the builder.
   * Only fills in fields that the builder chain has NOT explicitly set
   * (i.e. still at their default empty-string value).
   */
  mergeMetadata(meta: { name?: string; description?: string; author?: string; source_repo?: string }): this {
    if (!this._name && meta.name) this._name = meta.name;
    if (!this._description && meta.description) this._description = meta.description;
    if (!this._author && meta.author) this._author = meta.author;
    if (!this._sourceRepo && meta.source_repo) this._sourceRepo = meta.source_repo;
    return this;
  }
  profile(p: ToolProfileId | ToolProfileId[]): this {
    this._profiles = Array.isArray(p) ? p : [p];
    return this;
  }
  allowCommand(cmd: string | string[]): this { this._allowCommands.push(...(Array.isArray(cmd) ? cmd : [cmd])); return this; }
  allowHost(host: string | string[]): this { this._allowHosts.push(...(Array.isArray(host) ? host : [host])); return this; }
  allowTool(tool: string | string[]): this { this._allowTools.push(...(Array.isArray(tool) ? tool : [tool])); return this; }
  metric(m: string | string[]): this { this._metrics.push(...(Array.isArray(m) ? m : [m])); return this; }
  configDefault(key: string, value: unknown): this { this._configDefaults[key] = value; return this; }

  /**
   * Register a tool exposed by this extension.
   *
   * @param name    Unique tool name (must not collide with built-in tools).
   * @param desc    Human-readable description shown to the AI model.
   * @param schema  JSON-Schema **properties** object — the builder automatically
   *                wraps it in `{ type: 'object', properties: … }`, so you only
   *                need to pass the inner properties map.
   *                Example: `{ text: { type: 'string', description: 'Input' } }`
   * @param handler Async function `(args, ctx) => ToolResponse`.
   * @param profiles Optional profile tiers for this specific tool (defaults to extension-level profiles).
   */
  tool(
    name: string,
    desc: string,
    schema: Record<string, unknown>,
    handler: ExtensionToolHandler,
    profiles?: ToolProfileId[],
  ): this {
    this._tools.push({
      name,
      description: desc,
      schema: { type: 'object', properties: schema },
      handler,
      profiles,
    });
    return this;
  }

  onLoad(h: (ctx: PluginLifecycleContext) => Promise<void> | void): this { this._onLoadHandler = h; return this; }
  onValidate(h: (ctx: PluginLifecycleContext) => Promise<{valid: boolean; errors: string[]}> | {valid: boolean; errors: string[]}): this { this._onValidateHandler = h; return this; }
  onActivate(h: (ctx: PluginLifecycleContext) => Promise<void> | void): this { this._onActivateHandler = h; return this; }
  onDeactivate(h: (ctx: PluginLifecycleContext) => Promise<void> | void): this { this._onDeactivateHandler = h; return this; }
}

export function createExtension(id: string, version: string): ExtensionBuilder {
  return new ExtensionBuilder(id, version);
}
