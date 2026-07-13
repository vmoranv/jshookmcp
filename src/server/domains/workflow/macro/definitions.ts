import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const macroTools: Tool[] = [
  tool('run_macro', (t) =>
    t
      .desc(
        'Execute a registered macro with sequence, parallel, branch, fallback, and retry orchestration.',
      )
      .string('macroId', 'Macro ID to execute')
      .prop('inputOverrides', {
        type: 'object',
        description: 'Per-step input overrides keyed by step ID',
        additionalProperties: { type: 'object', additionalProperties: true },
      })
      .boolean(
        'dryRun',
        'Plan-preview: build the macro node tree and return the effective structure (with optional ' +
          'wrapping, retry, timeout, inputFrom refs) without executing any tools. Surfaces schema ' +
          'errors (e.g. a step with zero or multiple node kinds) before run time.',
        { default: false },
      )
      .required('macroId'),
  ),
  tool('list_macros', (t) => t.desc('List all available macros.').query()),
];
