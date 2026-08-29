import type { Tool } from '@modelcontextprotocol/server';
import { logger } from '@utils/logger';
import {
  getToolsByDomains,
  getToolsForProfile,
  parseToolDomains,
  type ToolProfile,
} from '@server/ToolCatalog';
import { readEnvNullableString, readEnvString } from '@src/config/environment';
import type { Config } from '@internal-types/config';

/** Valid MCP_TOOL_PROFILE values — mirrors the ToolProfileId union. */
const VALID_TOOL_PROFILES: ReadonlySet<string> = new Set(['search', 'workflow', 'full']);

/**
 * Resolve the tool profile from a raw MCP_TOOL_PROFILE value.
 * Unknown/invalid values fall back to the 'search' bootstrap tier.
 */
function resolveToolProfile(explicitProfile: string): ToolProfile {
  return VALID_TOOL_PROFILES.has(explicitProfile) ? (explicitProfile as ToolProfile) : 'search';
}

export function resolveToolsForRegistration(config?: Pick<Config, 'server' | 'mcp'>): {
  tools: Tool[];
  profile: ToolProfile;
} {
  const transportMode =
    config?.server?.transport ??
    readEnvString('MCP_TRANSPORT', 'stdio', { trim: true }).toLowerCase();
  const explicitProfile =
    config?.mcp?.toolProfile ??
    resolveToolProfile(readEnvString('MCP_TOOL_PROFILE', '', { trim: true }).toLowerCase());
  const explicitDomains = config?.mcp?.toolDomains
    ? parseToolDomains(config.mcp.toolDomains.join(','))
    : parseToolDomains(readEnvNullableString('MCP_TOOL_DOMAINS', { trim: true }) ?? undefined);

  if (explicitDomains && explicitDomains.length > 0) {
    const tools = getToolsByDomains(explicitDomains);
    logger.info(
      `Tool registration mode=domains [${explicitDomains.join(',')}], count=${tools.length}`,
    );
    return { tools, profile: explicitProfile };
  }

  const profile = explicitProfile;
  const tools = getToolsForProfile(profile);
  if (profile === 'search') {
    logger.info(
      `Tool registration mode=search bootstrap, transport=${transportMode}, baseCount=${tools.length}. ` +
        `Meta-tools remain available for domain activation and call_tool bridging.`,
    );
  } else {
    logger.info(
      `Tool registration mode=${profile}, transport=${transportMode}, count=${tools.length}`,
    );
  }
  return { tools, profile };
}
