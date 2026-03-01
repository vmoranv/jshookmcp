import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { advancedBrowserToolDefinitions } from './definitions.tools.advanced.js';
import { browserPageCoreTools } from './definitions.tools.page-core.js';
import { browserPageSystemTools } from './definitions.tools.page-system.js';
import { browserRuntimeTools } from './definitions.tools.runtime.js';
import { browserSecurityStateTools } from './definitions.tools.security.js';

export const browserTools: Tool[] = [
  ...browserRuntimeTools,
  ...browserPageCoreTools,
  ...browserPageSystemTools,
  ...browserSecurityStateTools,
];

export { advancedBrowserToolDefinitions };
