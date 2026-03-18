import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@utils/logger';
import {
  getToolsByDomains,
  getToolsForProfile,
  parseToolDomains,
  type ToolProfile,
} from '@server/ToolCatalog';

export function resolveToolsForRegistration(): { tools: Tool[]; profile: ToolProfile } {
  const transportMode = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();
  const explicitProfile = (process.env.MCP_TOOL_PROFILE ?? '').trim().toLowerCase();
  const explicitDomains = parseToolDomains(process.env.MCP_TOOL_DOMAINS);

  if (explicitDomains && explicitDomains.length > 0) {
    const tools = getToolsByDomains(explicitDomains);
    logger.info(
      `Tool registration mode=domains [${explicitDomains.join(',')}], count=${tools.length}`
    );
    const profile: ToolProfile =
      explicitProfile === 'full' || explicitProfile === 'workflow' || explicitProfile === 'search'
        ? explicitProfile
        : 'search';
    return { tools, profile };
  }

  let profile: ToolProfile;
  if (
    explicitProfile === 'full' ||
    explicitProfile === 'workflow' ||
    explicitProfile === 'search'
  ) {
    profile = explicitProfile;
  } else {
    profile = 'search';
  }

  const tools = getToolsForProfile(profile);
  logger.info(
    `Tool registration mode=${profile}, transport=${transportMode}, count=${tools.length}`
  );
  return { tools, profile };
}
