import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs } from '../types.js';
import type { BrowserToolHandlers } from '../domains/browser/index.js';
import type { DebuggerToolHandlers } from '../domains/debugger/index.js';
import type { AdvancedToolHandlers } from '../domains/network/index.js';
import type { AIHookToolHandlers, HookPresetToolHandlers } from '../domains/hooks/index.js';
import type { CoreAnalysisHandlers } from '../domains/analysis/index.js';
import type { CoreMaintenanceHandlers } from '../domains/maintenance/index.js';
import type { ProcessToolHandlers } from '../domains/process/index.js';
import type { WorkflowHandlers } from '../domains/workflow/index.js';
import type { WasmToolHandlers } from '../domains/wasm/index.js';
import type { StreamingToolHandlers } from '../domains/streaming/index.js';
import type { EncodingToolHandlers } from '../domains/encoding/index.js';
import type { AntiDebugToolHandlers } from '../domains/antidebug/index.js';
import type { GraphQLToolHandlers } from '../domains/graphql/index.js';
import type { PlatformToolHandlers } from '../domains/platform/index.js';
import type { SourcemapToolHandlers } from '../domains/sourcemap/index.js';
import type { TransformToolHandlers } from '../domains/transform/index.js';

/**
 * Domain names for tool grouping.
 * Canonical source — re-exported by ToolCatalog.ts for backward compatibility.
 */
export type ToolDomain =
  | 'core'
  | 'browser'
  | 'debugger'
  | 'network'
  | 'hooks'
  | 'maintenance'
  | 'process'
  | 'workflow'
  | 'wasm'
  | 'streaming'
  | 'encoding'
  | 'antidebug'
  | 'graphql'
  | 'platform'
  | 'sourcemap'
  | 'transform';

/**
 * Dependency container passed to tool handler bindings.
 * Moved here from ToolHandlerMap.ts to avoid circular imports.
 */
export interface ToolHandlerMapDependencies {
  browserHandlers: BrowserToolHandlers;
  debuggerHandlers: DebuggerToolHandlers;
  advancedHandlers: AdvancedToolHandlers;
  aiHookHandlers: AIHookToolHandlers;
  hookPresetHandlers: HookPresetToolHandlers;
  coreAnalysisHandlers: CoreAnalysisHandlers;
  coreMaintenanceHandlers: CoreMaintenanceHandlers;
  processHandlers: ProcessToolHandlers;
  workflowHandlers: WorkflowHandlers;
  wasmHandlers: WasmToolHandlers;
  streamingHandlers: StreamingToolHandlers;
  encodingHandlers: EncodingToolHandlers;
  antidebugHandlers: AntiDebugToolHandlers;
  graphqlHandlers: GraphQLToolHandlers;
  platformHandlers: PlatformToolHandlers;
  sourcemapHandlers: SourcemapToolHandlers;
  transformHandlers: TransformToolHandlers;
}

/**
 * Single source of truth for a tool: definition + domain + handler binding.
 *
 * Each domain's manifest.ts exports an array of these. The central registry
 * aggregates all manifests, replacing the three-way sync between
 * ToolCatalog / definitions / ToolHandlerMap.
 */
export interface ToolRegistration {
  /** Full MCP tool definition (name, description, inputSchema). */
  readonly tool: Tool;
  /** Domain this tool belongs to. */
  readonly domain: ToolDomain;
  /** Creates a handler function given the handler dependencies. */
  readonly bind: (deps: ToolHandlerMapDependencies) => (args: ToolArgs) => Promise<unknown>;
}

/**
 * Helper: create a name-based lookup from a Tool array.
 * Throws at module load time if a tool name is missing — acts as a build-time guard.
 */
export function toolLookup(tools: readonly Tool[]): (name: string) => Tool {
  const map = new Map(tools.map(t => [t.name, t]));
  return (name: string): Tool => {
    const tool = map.get(name);
    if (!tool) throw new Error(`[registry] Tool definition not found: "${name}"`);
    return tool;
  };
}
