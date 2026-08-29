import type { Tool } from '@modelcontextprotocol/server';
import { DEBUGGER_CORE_TOOLS } from '@server/domains/debugger/definitions.tools.core';
import { DEBUGGER_ADVANCED_TOOLS } from '@server/domains/debugger/definitions.tools.advanced';
import { antidebugTools } from '@server/domains/debugger/antidebug/definitions';

export const debuggerTools: Tool[] = [
  ...DEBUGGER_CORE_TOOLS,
  ...DEBUGGER_ADVANCED_TOOLS,
  ...antidebugTools,
];
