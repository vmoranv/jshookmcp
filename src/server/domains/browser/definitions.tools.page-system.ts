import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const browserPageSystemTools: Tool[] = [
  {
    name: 'console_enable',
    description: 'Enable console monitoring to capture console.log, console.error, etc.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'Enable Console Monitoring',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'console_get_logs',
    description: 'Get captured console logs',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by log type',
          enum: ['log', 'warn', 'error', 'info', 'debug'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of logs to return',
        },
        since: {
          type: 'number',
          description: 'Only return logs after this timestamp',
        },
      },
    },
    annotations: {
      title: 'Get Console Logs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'console_execute',
    description: 'Execute JavaScript expression in console context',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression to execute',
        },
      },
      required: ['expression'],
    },
    annotations: {
      title: 'Execute Console Expression',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },

  {
    name: 'dom_get_computed_style',
    description: 'Get computed CSS styles of an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
      },
      required: ['selector'],
    },
    annotations: {
      title: 'Get Computed Style',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'dom_find_by_text',
    description: 'Find elements by text content (useful for dynamic content)',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to search for',
        },
        tag: {
          type: 'string',
          description: 'Optional tag name to filter (e.g., "button", "a")',
        },
      },
      required: ['text'],
    },
    annotations: {
      title: 'Find Elements by Text',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'dom_get_xpath',
    description: 'Get XPath of an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
      },
      required: ['selector'],
    },
    annotations: {
      title: 'Get Element XPath',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'dom_is_in_viewport',
    description: 'Check if element is visible in viewport',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
      },
      required: ['selector'],
    },
    annotations: {
      title: 'Check Element Visibility',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: 'page_get_performance',
    description: 'Get page performance metrics (load time, network time, etc.)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'Get Performance Metrics',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'page_inject_script',
    description: 'Inject JavaScript code into page',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'JavaScript code to inject',
        },
      },
      required: ['script'],
    },
    annotations: {
      title: 'Inject Script',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'page_set_cookies',
    description: 'Set cookies for the page',
    inputSchema: {
      type: 'object',
      properties: {
        cookies: {
          type: 'array',
          description: 'Array of cookie objects',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              domain: { type: 'string' },
              path: { type: 'string' },
              expires: { type: 'number' },
              httpOnly: { type: 'boolean' },
              secure: { type: 'boolean' },
              sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
            },
            required: ['name', 'value'],
          },
        },
      },
      required: ['cookies'],
    },
    annotations: {
      title: 'Set Cookies',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'page_get_cookies',
    description: 'Get all cookies for the page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'Get Cookies',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'page_clear_cookies',
    description: 'Clear all cookies',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'Clear Cookies',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'page_set_viewport',
    description: 'Set viewport size',
    inputSchema: {
      type: 'object',
      properties: {
        width: {
          type: 'number',
          description: 'Viewport width',
        },
        height: {
          type: 'number',
          description: 'Viewport height',
        },
      },
      required: ['width', 'height'],
    },
    annotations: {
      title: 'Set Viewport Size',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'page_emulate_device',
    description: 'Emulate mobile device (iPhone, iPad, Android)',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description:
            'Device to emulate. Supports canonical values (iPhone, iPad, Android) and aliases like "iPhone 13" / "iPhone 14".',
        },
      },
      required: ['device'],
    },
    annotations: {
      title: 'Emulate Device',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'page_get_local_storage',
    description: 'Get all localStorage items',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'Get Local Storage',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'page_set_local_storage',
    description: 'Set localStorage item',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Storage key',
        },
        value: {
          type: 'string',
          description: 'Storage value',
        },
      },
      required: ['key', 'value'],
    },
    annotations: {
      title: 'Set Local Storage',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'page_press_key',
    description: 'Press a keyboard key (e.g., "Enter", "Escape", "ArrowDown")',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Key to press',
        },
      },
      required: ['key'],
    },
    annotations: {
      title: 'Press Key',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'page_get_all_links',
    description: 'Get all links on the page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'Get All Links',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
