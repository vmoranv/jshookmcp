import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const macroTools: Tool[] = [
  {
    name: 'run_macro',
    description:
      'Execute a registered macro by ID. Macros chain multiple MCP tools in sequence with inline progress reporting and atomic bailout.\n\nBuilt-in macros:\n- `deobfuscate_ast_flow` — deobfuscate → advanced deobfuscation → extract function tree\n- `unpacker_flow` — detect packer → extract → deobfuscate → beautify\n\nUser-defined macros are loaded from JSON files in `macros/` directory.\n\nUse `list_macros` to see all available macros.',
    inputSchema: {
      type: 'object',
      properties: {
        macroId: {
          type: 'string',
          description: 'ID of the macro to execute (e.g., "deobfuscate_ast_flow")',
        },
        inputOverrides: {
          type: 'object',
          description:
            'Optional per-step input overrides keyed by step ID (e.g., { "deobfuscate": { "code": "..." } })',
          additionalProperties: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      required: ['macroId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'list_macros',
    description: 'List all available macros (built-in + user-defined from macros/ directory).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
