import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DEBUGGER_CORE_TOOLS } from '@server/domains/debugger/definitions.tools.core';
import { DEBUGGER_ADVANCED_TOOLS } from '@server/domains/debugger/definitions.tools.advanced';

export const debuggerTools: Tool[] = [...DEBUGGER_CORE_TOOLS, ...DEBUGGER_ADVANCED_TOOLS];
