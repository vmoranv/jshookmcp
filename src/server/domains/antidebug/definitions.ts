import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const antidebugTools: Tool[] = [
  {
    name: 'antidebug_bypass_all',
    description:
      'Inject all anti-anti-debug bypass scripts into the current page. Uses evaluateOnNewDocument + evaluate dual injection.',
    inputSchema: {
      type: 'object',
      properties: {
        persistent: {
          type: 'boolean',
          description: 'Whether to also inject persistently for future documents (default: true).',
          default: true,
        },
      },
    },
  },
  {
    name: 'antidebug_bypass_debugger_statement',
    description:
      'Bypass debugger-statement based protection by patching Function constructor and monitoring dynamic script insertion.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          description: 'remove = strip debugger statements, noop = replace with void 0',
          enum: ['remove', 'noop'],
          default: 'remove',
        },
      },
    },
  },
  {
    name: 'antidebug_bypass_timing',
    description:
      'Bypass timing-based anti-debug checks by stabilizing performance.now / Date.now and console.time APIs.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDrift: {
          type: 'number',
          description: 'Maximum logical time drift allowed per call in milliseconds (default: 50).',
          default: 50,
        },
      },
    },
  },
  {
    name: 'antidebug_bypass_stack_trace',
    description:
      'Bypass Error.stack based anti-debug checks by filtering suspicious stack frames and hardening function toString.',
    inputSchema: {
      type: 'object',
      properties: {
        filterPatterns: {
          type: 'array',
          description:
            'Additional stack frame patterns to filter. Defaults include puppeteer/devtools/__puppeteer/CDP.',
          items: {
            type: 'string',
          },
        },
      },
    },
  },
  {
    name: 'antidebug_bypass_console_detect',
    description:
      'Bypass console-based devtools detection by wrapping console methods and sanitizing getter-based payloads.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'antidebug_detect_protections',
    description:
      'Detect anti-debug protections in the current page and return detected techniques with bypass recommendations.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
