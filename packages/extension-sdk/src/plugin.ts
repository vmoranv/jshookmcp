import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { toTextResponse, toErrorResponse } from '@extension-sdk/bridges/shared';
import type { WorkflowContract } from './workflow.js';

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

export type ExtensionToolHandler = (
  args: ToolArgs,
  ctx: PluginLifecycleContext,
) => Promise<ToolResponse>;

export type ExtensionToolInputSchema = Tool['inputSchema'];

export interface ExtensionToolDefinition {
  name: string;
  description: string;
  schema: ExtensionToolInputSchema;
  handler: ExtensionToolHandler;
  /** Profile tiers this tool should be available in (default: ['full']). */
  profiles?: ToolProfileId[];
}

export type ExtensionWorkflowDefinition = WorkflowContract;

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
  private readonly idValue: string;
  private readonly versionValue: string;
  private nameValue: string = '';
  private descriptionValue: string = '';
  private authorValue: string = '';
  private sourceRepoValue: string = '';
  private compatibleCoreValue: string = '>=0.1.0';
  private profilesValue: ToolProfileId[] = ['full'];
  private toolsValue: ExtensionToolDefinition[] = [];
  private workflowsValue: ExtensionWorkflowDefinition[] = [];
  private allowedCommandsValue: string[] = [];
  private allowedHostsValue: string[] = [];
  private allowedToolsValue: string[] = [];
  private metricsValue: string[] = [];
  private configDefaultsValue: Record<string, unknown> = {};
  private onLoadHandlerValue?: (ctx: PluginLifecycleContext) => Promise<void> | void;
  private onValidateHandlerValue?: (
    ctx: PluginLifecycleContext,
  ) => Promise<{ valid: boolean; errors: string[] }> | { valid: boolean; errors: string[] };
  private onActivateHandlerValue?: (ctx: PluginLifecycleContext) => Promise<void> | void;
  private onDeactivateHandlerValue?: (ctx: PluginLifecycleContext) => Promise<void> | void;

  constructor(id: string, version: string) {
    this.idValue = id;
    this.versionValue = version;
  }

  // ── accessors ──

  get id(): string {
    return this.idValue;
  }
  get version(): string {
    return this.versionValue;
  }
  get pluginName(): string {
    return this.nameValue;
  }
  get pluginDescription(): string {
    return this.descriptionValue;
  }
  get pluginAuthor(): string {
    return this.authorValue;
  }
  get pluginSourceRepo(): string {
    return this.sourceRepoValue;
  }
  get compatibleCoreRange(): string {
    return this.compatibleCoreValue;
  }
  get profiles(): ToolProfileId[] {
    return this.profilesValue;
  }
  get tools(): ExtensionToolDefinition[] {
    return this.toolsValue;
  }
  get workflows(): ExtensionWorkflowDefinition[] {
    return this.workflowsValue;
  }
  get allowedCommands(): string[] {
    return this.allowedCommandsValue;
  }
  get allowedHosts(): string[] {
    return this.allowedHostsValue;
  }
  get allowedTools(): string[] {
    return this.allowedToolsValue;
  }
  get declaredMetrics(): string[] {
    return this.metricsValue;
  }
  get configDefaults(): Record<string, unknown> {
    return this.configDefaultsValue;
  }
  get onLoadHandler(): ((ctx: PluginLifecycleContext) => Promise<void> | void) | undefined {
    return this.onLoadHandlerValue;
  }
  get onValidateHandler():
    | ((
        ctx: PluginLifecycleContext,
      ) => Promise<{ valid: boolean; errors: string[] }> | { valid: boolean; errors: string[] })
    | undefined {
    return this.onValidateHandlerValue;
  }
  get onActivateHandler(): ((ctx: PluginLifecycleContext) => Promise<void> | void) | undefined {
    return this.onActivateHandlerValue;
  }
  get onDeactivateHandler(): ((ctx: PluginLifecycleContext) => Promise<void> | void) | undefined {
    return this.onDeactivateHandlerValue;
  }

  // ── setters ──

  name(n: string): this {
    this.nameValue = n;
    return this;
  }
  description(desc: string): this {
    this.descriptionValue = desc;
    return this;
  }
  author(a: string): this {
    this.authorValue = a;
    return this;
  }
  sourceRepo(url: string): this {
    this.sourceRepoValue = url;
    return this;
  }
  compatibleCore(range: string): this {
    this.compatibleCoreValue = range;
    return this;
  }

  /**
   * Merge external metadata (e.g. from meta.yaml) into the builder.
   * Only fills in fields that the builder chain has NOT explicitly set
   * (i.e. still at their default empty-string value).
   */
  mergeMetadata(meta: {
    name?: string;
    description?: string;
    author?: string;
    source_repo?: string;
  }): this {
    if (!this.nameValue && meta.name) this.nameValue = meta.name;
    if (!this.descriptionValue && meta.description) this.descriptionValue = meta.description;
    if (!this.authorValue && meta.author) this.authorValue = meta.author;
    if (!this.sourceRepoValue && meta.source_repo) this.sourceRepoValue = meta.source_repo;
    return this;
  }
  profile(p: ToolProfileId | ToolProfileId[]): this {
    this.profilesValue = Array.isArray(p) ? p : [p];
    return this;
  }
  allowCommand(cmd: string | string[]): this {
    this.allowedCommandsValue.push(...(Array.isArray(cmd) ? cmd : [cmd]));
    return this;
  }
  allowHost(host: string | string[]): this {
    this.allowedHostsValue.push(...(Array.isArray(host) ? host : [host]));
    return this;
  }
  allowTool(tool: string | string[]): this {
    this.allowedToolsValue.push(...(Array.isArray(tool) ? tool : [tool]));
    return this;
  }
  metric(m: string | string[]): this {
    this.metricsValue.push(...(Array.isArray(m) ? m : [m]));
    return this;
  }
  configDefault(key: string, value: unknown): this {
    this.configDefaultsValue[key] = value;
    return this;
  }

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
    schema: Record<string, object>,
    handler: ExtensionToolHandler,
    profiles?: ToolProfileId[],
  ): this {
    this.toolsValue.push({
      name,
      description: desc,
      schema: { type: 'object', properties: schema },
      handler,
      profiles,
    });
    return this;
  }

  /**
   * Register one or more workflow contracts exposed by this extension.
   *
   * These workflows are registered by the core extension manager alongside
   * standalone workflow roots, while still preserving plugin ownership.
   */
  workflow(workflow: ExtensionWorkflowDefinition | ExtensionWorkflowDefinition[]): this {
    this.workflowsValue.push(...(Array.isArray(workflow) ? workflow : [workflow]));
    return this;
  }

  onLoad(h: (ctx: PluginLifecycleContext) => Promise<void> | void): this {
    this.onLoadHandlerValue = h;
    return this;
  }
  onValidate(
    h: (
      ctx: PluginLifecycleContext,
    ) => Promise<{ valid: boolean; errors: string[] }> | { valid: boolean; errors: string[] },
  ): this {
    this.onValidateHandlerValue = h;
    return this;
  }
  onActivate(h: (ctx: PluginLifecycleContext) => Promise<void> | void): this {
    this.onActivateHandlerValue = h;
    return this;
  }
  onDeactivate(h: (ctx: PluginLifecycleContext) => Promise<void> | void): this {
    this.onDeactivateHandlerValue = h;
    return this;
  }
}

export function createExtension(id: string, version: string): ExtensionBuilder {
  return new ExtensionBuilder(id, version);
}
