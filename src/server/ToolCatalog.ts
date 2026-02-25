import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { coreTools } from './domains/analysis/index.js';
import { browserTools } from './domains/browser/index.js';
import { debuggerTools } from './domains/debugger/index.js';
import { advancedTools } from './domains/network/index.js';
import { aiHookTools, hookPresetTools } from './domains/hooks/index.js';
import { tokenBudgetTools, cacheTools } from './domains/maintenance/index.js';
import { processToolDefinitions } from './domains/process/index.js';

export const allTools: Tool[] = [
  ...coreTools,
  ...browserTools,
  ...debuggerTools,
  ...advancedTools,
  ...aiHookTools,
  ...hookPresetTools,
  ...tokenBudgetTools,
  ...cacheTools,
  ...processToolDefinitions,
];
