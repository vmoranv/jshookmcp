import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { antidebugTools } from './definitions.js';

const t = toolLookup(antidebugTools);

export const antidebugRegistrations: readonly ToolRegistration[] = [
  { tool: t('antidebug_bypass_all'), domain: 'antidebug', bind: (d) => (a) => d.antidebugHandlers.handleAntiDebugBypassAll(a) },
  { tool: t('antidebug_bypass_debugger_statement'), domain: 'antidebug', bind: (d) => (a) => d.antidebugHandlers.handleAntiDebugBypassDebuggerStatement(a) },
  { tool: t('antidebug_bypass_timing'), domain: 'antidebug', bind: (d) => (a) => d.antidebugHandlers.handleAntiDebugBypassTiming(a) },
  { tool: t('antidebug_bypass_stack_trace'), domain: 'antidebug', bind: (d) => (a) => d.antidebugHandlers.handleAntiDebugBypassStackTrace(a) },
  { tool: t('antidebug_bypass_console_detect'), domain: 'antidebug', bind: (d) => (a) => d.antidebugHandlers.handleAntiDebugBypassConsoleDetect(a) },
  { tool: t('antidebug_detect_protections'), domain: 'antidebug', bind: (d) => (a) => d.antidebugHandlers.handleAntiDebugDetectProtections(a) },
];
