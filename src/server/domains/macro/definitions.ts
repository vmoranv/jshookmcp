import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const macroTools: Tool[] = [
  tool('run_macro', (t) =>
    t
      .desc('Execute a registered macro by ID with inline progress and atomic bailout')
      .string('macroId', 'Macro ID to execute')
      .prop('inputOverrides', {
        type: 'object',
        description: 'Per-step input overrides keyed by step ID',
        additionalProperties: { type: 'object', additionalProperties: true },
      })
      .required('macroId'),
  ),
  tool('list_macros', (t) => t.desc('List all available macros (built-in + user-defined)').query()),
];
