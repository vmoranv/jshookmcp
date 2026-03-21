import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const sandboxTools: Tool[] = [
  {
    name: 'execute_sandbox_script',
    description:
      'Execute JavaScript code in a WASM-isolated QuickJS sandbox with optional MCP tool bridging, session persistence, and auto-correction.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript source code to execute inside the sandbox.',
        },
        sessionId: {
          type: 'string',
          description:
            'Optional session ID for scratchpad persistence across executions. If omitted, no persistence.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Execution timeout in ms (default: 1000).',
        },
        autoCorrect: {
          type: 'boolean',
          description:
            'When true, failed scripts are retried up to 2 times with error context appended.',
          default: false,
        },
      },
      required: ['code'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];
