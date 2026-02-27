import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const transformTools: Tool[] = [
  {
    name: 'ast_transform_preview',
    description:
      'Preview lightweight AST-like transforms (string/regex based) and return before/after diff.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Source code to transform.',
        },
        transforms: {
          type: 'array',
          description: 'Ordered transform list.',
          items: {
            type: 'string',
            enum: [
              'constant_fold',
              'string_decrypt',
              'dead_code_remove',
              'control_flow_flatten',
              'rename_vars',
            ],
          },
        },
        preview: {
          type: 'boolean',
          description: 'Whether to generate line diff output.',
          default: true,
        },
      },
      required: ['code', 'transforms'],
    },
  },
  {
    name: 'ast_transform_chain',
    description: 'Create and store an in-memory transform chain.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Chain name.',
        },
        transforms: {
          type: 'array',
          description: 'Ordered transform list.',
          items: {
            type: 'string',
            enum: [
              'constant_fold',
              'string_decrypt',
              'dead_code_remove',
              'control_flow_flatten',
              'rename_vars',
            ],
          },
        },
        description: {
          type: 'string',
          description: 'Optional chain description.',
        },
      },
      required: ['name', 'transforms'],
    },
  },
  {
    name: 'ast_transform_apply',
    description: 'Apply transforms to input code or a live page scriptId.',
    inputSchema: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: 'Target script ID from page debugger context.',
        },
        code: {
          type: 'string',
          description: 'Direct source code input.',
        },
        chainName: {
          type: 'string',
          description: 'Use a saved transform chain by name.',
        },
        transforms: {
          type: 'array',
          description: 'Direct transform list (used when chainName is not provided).',
          items: {
            type: 'string',
            enum: [
              'constant_fold',
              'string_decrypt',
              'dead_code_remove',
              'control_flow_flatten',
              'rename_vars',
            ],
          },
        },
      },
      required: [],
    },
  },
  {
    name: 'crypto_extract_standalone',
    description:
      'Extract crypto/sign/encrypt function from current page and generate standalone runnable code.',
    inputSchema: {
      type: 'object',
      properties: {
        targetFunction: {
          type: 'string',
          description: 'Target function name/path, e.g. "window.sign".',
        },
        includePolyfills: {
          type: 'boolean',
          description: 'Include minimal runtime polyfills.',
          default: true,
        },
      },
      required: ['targetFunction'],
    },
  },
  {
    name: 'crypto_test_harness',
    description:
      'Run extracted crypto code in worker_threads + vm sandbox and return deterministic test results.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Standalone function code.',
        },
        functionName: {
          type: 'string',
          description: 'Exported function name to execute.',
        },
        testInputs: {
          type: 'array',
          description: 'Input list for test execution.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['code', 'functionName', 'testInputs'],
    },
  },
  {
    name: 'crypto_compare',
    description: 'Compare two crypto implementations against identical test vectors.',
    inputSchema: {
      type: 'object',
      properties: {
        code1: {
          type: 'string',
          description: 'Implementation A code.',
        },
        code2: {
          type: 'string',
          description: 'Implementation B code.',
        },
        functionName: {
          type: 'string',
          description: 'Function name shared by both implementations.',
        },
        testInputs: {
          type: 'array',
          description: 'Input list for comparison.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['code1', 'code2', 'functionName', 'testInputs'],
    },
  },
];
