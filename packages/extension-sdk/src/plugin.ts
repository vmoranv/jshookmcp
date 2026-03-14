

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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
}

export class ExtensionBuilder {
  public _id: string;
  public _version: string;
  constructor(id: string, version: string) {
    this._id = id;
    this._version = version;
  }

  get id(): string { return this._id; }
  get version(): string { return this._version; }

  public _name: string = '';
  public _description: string = '';
  public _compatibleCore: string = '>=0.1.0';
  public _tools: ExtensionToolDefinition[] = [];
  public _allowCommands: string[] = [];
  public _allowHosts: string[] = [];
  public _allowTools: string[] = [];
  public _metrics: string[] = [];
  public _configDefaults: Record<string, unknown> = {};
  public _onLoadHandler?: (ctx: PluginLifecycleContext) => Promise<void> | void;
  public _onValidateHandler?: (ctx: PluginLifecycleContext) => Promise<{valid: boolean; errors: string[]}> | {valid: boolean; errors: string[]};
  public _onActivateHandler?: (ctx: PluginLifecycleContext) => Promise<void> | void;
  public _onDeactivateHandler?: (ctx: PluginLifecycleContext) => Promise<void> | void;

  get getName(): string { return this._name; }
  get getDescription(): string { return this._description; }
  get getCompatibleCore(): string { return this._compatibleCore; }
  get tools(): ExtensionToolDefinition[] { return this._tools; }
  get allowCommands(): string[] { return this._allowCommands; }
  get allowHosts(): string[] { return this._allowHosts; }
  get allowTools(): string[] { return this._allowTools; }
  get metrics(): string[] { return this._metrics; }
  get configDefaults(): Record<string, unknown> { return this._configDefaults; }
  get onLoadHandler() { return this._onLoadHandler; }
  get onValidateHandler() { return this._onValidateHandler; }
  get onActivateHandler() { return this._onActivateHandler; }
  get onDeactivateHandler() { return this._onDeactivateHandler; }

  name(name: string): this { this._name = name; return this; }
  description(desc: string): this { this._description = desc; return this; }
  compatibleCore(range: string): this { this._compatibleCore = range; return this; }
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
   */
  tool(name: string, desc: string, schema: Record<string, unknown>, handler: ExtensionToolHandler): this {
    this._tools.push({ name, description: desc, schema: { type: 'object', properties: schema }, handler });
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
