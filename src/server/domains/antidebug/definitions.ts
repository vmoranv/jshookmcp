import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const antidebugTools: Tool[] = [
  tool('antidebug_bypass', (t) =>
    t
      .desc(
        'Bypass one or more anti-debug protection types. Specify types to apply; omit or use ["all"] to apply all bypasses. Types: all, debugger_statement, timing, stack_trace, console_detect.',
      )
      .array(
        'types',
        {
          type: 'string',
          enum: ['all', 'debugger_statement', 'timing', 'stack_trace', 'console_detect'],
        },
        'Bypass types to apply (default: ["all"])',
      )
      .boolean('persistent', 'Inject persistently for future documents', { default: true })
      .enum('mode', ['remove', 'noop'], 'Debugger statement mode (for debugger_statement type)', {
        default: 'remove',
      })
      .number('maxDrift', 'Max timing drift per call in ms (for timing type)', { default: 50 })
      .array(
        'filterPatterns',
        { type: 'string' },
        'Additional stack frame patterns to filter (for stack_trace type)',
      ),
  ),
  tool('antidebug_detect_protections', (t) =>
    t.desc('Detect anti-debug protections in current page with bypass recommendations'),
  ),
];
