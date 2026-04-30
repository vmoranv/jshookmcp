import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { analysisTools } from './definitions/analysis-tools';
import { captureTools } from './definitions/capture-tools';
import { consoleTools } from './definitions/console-tools';
import { probeTools } from './definitions/probe-tools';
import { transportTools } from './definitions/transport-tools';

export const advancedTools: Tool[] = [
  ...captureTools,
  ...consoleTools,
  ...transportTools,
  ...analysisTools,
  ...probeTools,
];
