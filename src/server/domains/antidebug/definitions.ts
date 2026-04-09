import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const antidebugTools: Tool[] = [
  tool('antidebug_bypass_all', (t) =>
    t
      .desc('Inject all anti-anti-debug bypass scripts via dual injection')
      .boolean('persistent', 'Also inject persistently for future documents', { default: true }),
  ),
  tool('antidebug_bypass_debugger_statement', (t) =>
    t
      .desc('Bypass debugger-statement protection by patching Function constructor')
      .enum('mode', ['remove', 'noop'], 'remove = strip statements, noop = replace with void 0', {
        default: 'remove',
      }),
  ),
  tool('antidebug_bypass_timing', (t) =>
    t
      .desc('Bypass timing-based anti-debug by stabilizing performance.now / Date.now')
      .number('maxDrift', 'Max logical time drift per call in ms', { default: 50 }),
  ),
  tool('antidebug_bypass_stack_trace', (t) =>
    t
      .desc('Bypass Error.stack anti-debug by filtering suspicious frames and hardening toString')
      .array('filterPatterns', { type: 'string' }, 'Additional stack frame patterns to filter'),
  ),
  tool('antidebug_bypass_console_detect', (t) =>
    t.desc('Bypass console-based devtools detection by wrapping console methods'),
  ),
  tool('antidebug_detect_protections', (t) =>
    t.desc('Detect anti-debug protections in current page with bypass recommendations'),
  ),
];
