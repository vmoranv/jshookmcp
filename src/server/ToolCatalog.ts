import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { coreTools } from './domains/analysis/index.js';
import { browserTools } from './domains/browser/index.js';
import { debuggerTools } from './domains/debugger/index.js';
import { advancedTools } from './domains/network/index.js';
import { aiHookTools, hookPresetTools } from './domains/hooks/index.js';
import { tokenBudgetTools, cacheTools } from './domains/maintenance/index.js';
import { processToolDefinitions } from './domains/process/index.js';

export type ToolDomain =
  | 'core'
  | 'browser'
  | 'debugger'
  | 'network'
  | 'hooks'
  | 'maintenance'
  | 'process';

export type ToolProfile = 'minimal' | 'full';

const TOOL_GROUPS: Record<ToolDomain, Tool[]> = {
  core: coreTools,
  browser: browserTools,
  debugger: debuggerTools,
  network: advancedTools,
  hooks: [...aiHookTools, ...hookPresetTools],
  maintenance: [...tokenBudgetTools, ...cacheTools],
  process: processToolDefinitions,
};

const TOOL_DOMAIN_BY_NAME: ReadonlyMap<string, ToolDomain> = (() => {
  const map = new Map<string, ToolDomain>();
  for (const [domain, tools] of Object.entries(TOOL_GROUPS) as Array<[ToolDomain, Tool[]]>) {
    for (const tool of tools) {
      if (!map.has(tool.name)) {
        map.set(tool.name, domain);
      }
    }
  }
  return map;
})();

export const allTools: Tool[] = [
  ...TOOL_GROUPS.core,
  ...TOOL_GROUPS.browser,
  ...TOOL_GROUPS.debugger,
  ...TOOL_GROUPS.network,
  ...TOOL_GROUPS.hooks,
  ...TOOL_GROUPS.maintenance,
  ...TOOL_GROUPS.process,
];

const PROFILE_DOMAINS: Record<ToolProfile, ToolDomain[]> = {
  minimal: ['browser', 'debugger', 'network', 'maintenance'],
  full: ['core', 'browser', 'debugger', 'network', 'hooks', 'maintenance', 'process'],
};

function dedupeTools(tools: Tool[]): Tool[] {
  const map = new Map<string, Tool>();
  for (const tool of tools) {
    map.set(tool.name, tool);
  }
  return Array.from(map.values());
}

export function parseToolDomains(raw: string | undefined): ToolDomain[] | null {
  if (!raw?.trim()) {
    return null;
  }

  const validDomains = new Set<ToolDomain>(Object.keys(TOOL_GROUPS) as ToolDomain[]);
  const parsed = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item): item is ToolDomain => validDomains.has(item as ToolDomain));

  return parsed.length > 0 ? (Array.from(new Set(parsed)) as ToolDomain[]) : null;
}

export function getToolsByDomains(domains: ToolDomain[]): Tool[] {
  const tools = domains.flatMap((domain) => TOOL_GROUPS[domain] ?? []);
  return dedupeTools(tools);
}

export function getToolsForProfile(profile: ToolProfile): Tool[] {
  const domains = PROFILE_DOMAINS[profile];
  return getToolsByDomains(domains);
}

export function getToolDomain(toolName: string): ToolDomain | null {
  return TOOL_DOMAIN_BY_NAME.get(toolName) ?? null;
}
