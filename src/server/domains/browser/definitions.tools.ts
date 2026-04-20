import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { advancedBrowserToolDefinitions } from '@server/domains/browser/definitions.tools.advanced';
import { browserPageCoreTools } from '@server/domains/browser/definitions.tools.page-core';
import { browserPageSystemTools } from '@server/domains/browser/definitions.tools.page-system';
import { browserRuntimeTools } from '@server/domains/browser/definitions.tools.runtime';
import { browserSecurityStateTools } from '@server/domains/browser/definitions.tools.security';
import { behaviorTools } from '@server/domains/browser/definitions.tools.behavior';
import { browserJsdomToolDefinitions } from '@server/domains/browser/definitions.tools.jsdom';

export const browserTools: Tool[] = [
  ...browserRuntimeTools,
  ...browserPageCoreTools,
  ...browserPageSystemTools,
  ...browserSecurityStateTools,
  ...behaviorTools,
  ...browserJsdomToolDefinitions,
];

export { advancedBrowserToolDefinitions, browserJsdomToolDefinitions };
