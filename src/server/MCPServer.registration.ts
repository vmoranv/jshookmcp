import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';
import {
  getToolsByDomains,
  getToolsForProfile,
  parseToolDomains,
  type ToolProfile,
} from './ToolCatalog.js';

export function resolveToolsForRegistration(): { tools: Tool[]; profile: ToolProfile } {
  const transportMode = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();
  const explicitProfile = (process.env.MCP_TOOL_PROFILE ?? '').trim().toLowerCase();
  const explicitDomains = parseToolDomains(process.env.MCP_TOOL_DOMAINS);

  if (explicitDomains && explicitDomains.length > 0) {
    const tools = getToolsByDomains(explicitDomains);
    logger.info(`Tool registration mode=domains [${explicitDomains.join(',')}], count=${tools.length}`);
    const profile: ToolProfile =
      explicitProfile === 'minimal' ||
      explicitProfile === 'full' ||
      explicitProfile === 'workflow' ||
      explicitProfile === 'reverse'
        ? (explicitProfile as ToolProfile)
        : 'minimal';
    return { tools, profile };
  }

  let profile: ToolProfile;
  if (
    explicitProfile === 'minimal' ||
    explicitProfile === 'full' ||
    explicitProfile === 'workflow' ||
    explicitProfile === 'reverse'
  ) {
    profile = explicitProfile as ToolProfile;
  } else {
    profile = transportMode === 'stdio' ? 'minimal' : 'workflow';
  }

  const tools = getToolsForProfile(profile);
  logger.info(`Tool registration mode=${profile}, transport=${transportMode}, count=${tools.length}`);
  return { tools, profile };
}
