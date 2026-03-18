import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  ExtensionBuilder,
  PluginLifecycleContext,
  PluginState,
} from '@server/plugins/PluginContract';
import type { WorkflowContract } from '@server/workflows/WorkflowContract';

export interface ExtensionToolRecord {
  name: string;
  domain: string;
  source: string;
  tool: Tool;
  registeredTool?: RegisteredTool;
  /** Minimum tier at which this tool is auto-registered during boost. */
  boostTier?: string;
  /** Bound handler captured at load time for deferred registration. */
  handler?: Function;
}

export interface ExtensionPluginRecord {
  id: string;
  name: string;
  source: string;
  domains: string[];
  workflows: string[];
  tools: string[];
}

export interface ExtensionPluginRuntimeRecord {
  plugin: ExtensionBuilder;
  lifecycleContext: PluginLifecycleContext;
  state: PluginState;
  source: string;
}

export interface ExtensionWorkflowRuntimeRecord {
  workflow: WorkflowContract;
  source: string;
}

export interface ExtensionWorkflowRecord {
  id: string;
  displayName: string;
  source: string;
  description?: string;
  tags?: string[];
  timeoutMs?: number;
  defaultMaxConcurrency?: number;
}

export interface ExtensionListResult {
  pluginRoots: string[];
  workflowRoots: string[];
  pluginCount: number;
  workflowCount: number;
  toolCount: number;
  lastReloadAt?: string;
  plugins: ExtensionPluginRecord[];
  workflows: ExtensionWorkflowRecord[];
  tools: Array<{
    name: string;
    domain: string;
    source: string;
  }>;
}

export interface ExtensionReloadResult extends ExtensionListResult {
  addedTools: number;
  removedTools: number;
  errors: string[];
  warnings: string[];
}
