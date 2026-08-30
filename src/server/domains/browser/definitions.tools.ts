import type { Tool } from '@modelcontextprotocol/server';
import { advancedBrowserToolDefinitions } from '@server/domains/browser/definitions.tools.advanced';
import { browserPageCoreTools } from '@server/domains/browser/definitions.tools.page-core';
import { browserPageSystemTools } from '@server/domains/browser/definitions.tools.page-system';
import { browserRuntimeTools } from '@server/domains/browser/definitions.tools.runtime';
import { browserSecurityStateTools } from '@server/domains/browser/definitions.tools.security';
import { behaviorTools } from '@server/domains/browser/definitions.tools.behavior';
import { browserJsdomToolDefinitions } from '@server/domains/browser/definitions.tools.jsdom';
import { browserPerformanceToolDefinitions } from '@server/domains/browser/definitions.tools.performance';

export const browserTools: Tool[] = [
  ...browserRuntimeTools,
  ...browserPageCoreTools,
  ...browserPageSystemTools,
  ...browserSecurityStateTools,
  ...behaviorTools,
  ...browserJsdomToolDefinitions,
  ...browserPerformanceToolDefinitions,
];

export { advancedBrowserToolDefinitions, browserJsdomToolDefinitions };
