import type { RegisteredTool, Tool } from '@modelcontextprotocol/server';
import type {
  ExtensionBuilder,
  PluginLifecycleContext,
  PluginState,
} from '@server/plugins/PluginContract';
import type { ToolProfileId } from '@server/registry/contracts';
import type { WorkflowContract } from '@server/workflows/WorkflowContract';

export const INSTALLED_EXTENSION_METADATA_FILENAME = '.jshook-install.json';

export interface InstalledExtensionMetadata {
  version: 1;
  kind: 'plugin' | 'workflow';
  slug: string;
  id: string;
  source: {
    type: string;
    repo: string;
    ref: string;
    commit: string;
    subpath: string;
    entry: string;
  };
}

export interface ExtensionToolRecord {
  name: string;
  domain: string;
  source: string;
  tool: Tool;
  registeredTool?: RegisteredTool;
  activatedAt?: string;
  activationSource?: 'reload' | 'activate_tools' | 'activate_domain';
  /** Profiles in which this tool should be auto-registered on reload. */
  profiles?: readonly ToolProfileId[];
  /** Bound handler captured at load time for deferred registration. */
  handler?: Function;
}

export interface ExtensionPluginRecord {
  id: string;
  name: string;
  description?: string;
  source: string;
  author?: string;
  sourceRepo?: string;
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
  route?: WorkflowContract['route'];
}

export interface ExtensionWorkflowRecord {
  id: string;
  displayName: string;
  source: string;
  description?: string;
  tags?: string[];
  timeoutMs?: number;
  defaultMaxConcurrency?: number;
  route?: WorkflowContract['route'];
}

export interface ExtensionListResult {
  pluginRoots: string[];
  workflowRoots: string[];
  pluginCount: number;
  workflowCount: number;
  toolCount: number;
  activeToolCount: number;
  currentProfile: ToolProfileId;
  lastReloadAt?: string;
  plugins: ExtensionPluginRecord[];
  workflows: ExtensionWorkflowRecord[];
  tools: Array<{
    name: string;
    domain: string;
    source: string;
    profiles: readonly ToolProfileId[];
    visibleInCurrentProfile: boolean;
    active: boolean;
    activationSource?: 'reload' | 'activate_tools' | 'activate_domain';
    activatedAt?: string;
  }>;
}

export interface ExtensionReloadResult extends ExtensionListResult {
  addedTools: number;
  autoActivatedTools: string[];
  removedTools: number;
  errors: string[];
  warnings: string[];
}
