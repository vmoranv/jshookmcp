import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const antidebugTools: Tool[] = [
  tool('antidebug_bypass_all')
    .desc('Inject all anti-anti-debug bypass scripts via dual injection')
    .boolean('persistent', 'Also inject persistently for future documents', { default: true })
    .build(),

  tool('antidebug_bypass_debugger_statement')
    .desc('Bypass debugger-statement protection by patching Function constructor')
    .enum('mode', ['remove', 'noop'], 'remove = strip statements, noop = replace with void 0', {
      default: 'remove',
    })
    .build(),

  tool('antidebug_bypass_timing')
    .desc('Bypass timing-based anti-debug by stabilizing performance.now / Date.now')
    .number('maxDrift', 'Max logical time drift per call in ms', { default: 50 })
    .build(),

  tool('antidebug_bypass_stack_trace')
    .desc('Bypass Error.stack anti-debug by filtering suspicious frames and hardening toString')
    .array('filterPatterns', { type: 'string' }, 'Additional stack frame patterns to filter')
    .build(),

  tool('antidebug_bypass_console_detect')
    .desc('Bypass console-based devtools detection by wrapping console methods')
    .build(),

  tool('antidebug_detect_protections')
    .desc('Detect anti-debug protections in current page with bypass recommendations')
    .build(),
];
