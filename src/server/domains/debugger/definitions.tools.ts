import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DEBUGGER_CORE_TOOLS } from './definitions.tools.core.js';
import { DEBUGGER_ADVANCED_TOOLS } from './definitions.tools.advanced.js';

export const debuggerTools: Tool[] = [
  ...DEBUGGER_CORE_TOOLS,
  ...DEBUGGER_ADVANCED_TOOLS,
];
