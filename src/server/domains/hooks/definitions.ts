import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const aiHookTools: Tool[] = [
  {
    name: 'ai_hook_generate',
    description:
      'Generate hook code for a target function, API, or object method.\n\nHook types:\n- function: Hook a named global function (e.g. window.btoa)\n- object-method: Hook a method on an object (e.g. crypto.subtle.encrypt)\n- api: Hook a built-in API (e.g. fetch, XMLHttpRequest)\n- property: Hook a property getter/setter\n- event: Hook an event listener\n- custom: Provide custom hook code\n\nAfter generating, inject the hook with ai_hook_inject.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'What the hook should do (e.g., "Capture all fetch requests to /api")',
        },
        target: {
          type: 'object',
          description: 'Hook target specification',
          properties: {
            type: {
              type: 'string',
              enum: ['function', 'object-method', 'api', 'property', 'event', 'custom'],
              description: 'Hook type',
            },
            name: {
              type: 'string',
              description: 'Function or API name (e.g., "btoa", "fetch")',
            },
            pattern: {
              type: 'string',
              description: 'Pattern for matching (used with api type)',
            },
            object: {
              type: 'string',
              description: 'Object path (e.g., "window.crypto.subtle")',
            },
            property: {
              type: 'string',
              description: 'Property name to hook',
            },
          },
          required: ['type'],
        },
        behavior: {
          type: 'object',
          description: 'Hook behavior configuration',
          properties: {
            captureArgs: {
              type: 'boolean',
              description: 'Capture function arguments',
              default: true,
            },
            captureReturn: {
              type: 'boolean',
              description: 'Capture return value',
              default: true,
            },
            captureStack: {
              type: 'boolean',
              description: 'Capture call stack',
              default: false,
            },
            modifyArgs: {
              type: 'boolean',
              description: 'Allow argument modification',
              default: false,
            },
            modifyReturn: {
              type: 'boolean',
              description: 'Allow return value modification',
              default: false,
            },
            blockExecution: {
              type: 'boolean',
              description: 'Block the original function from executing',
              default: false,
            },
            logToConsole: {
              type: 'boolean',
              description: 'Log hook events to console',
              default: true,
            },
          },
        },
        condition: {
          type: 'object',
          description: 'Conditional trigger for the hook',
          properties: {
            argFilter: {
              type: 'string',
              description:
                'JS expression to filter by args (e.g., "args[0].includes(\'password\')")',
            },
            returnFilter: {
              type: 'string',
              description: 'JS expression to filter by return value',
            },
            urlPattern: {
              type: 'string',
              description: 'Regex pattern to match request URL',
            },
            maxCalls: {
              type: 'number',
              description: 'Stop capturing after this many calls',
            },
          },
        },
        customCode: {
          type: 'object',
          description: 'Custom code to inject at hook points',
          properties: {
            before: {
              type: 'string',
              description: 'Code to run before the original function',
            },
            after: {
              type: 'string',
              description: 'Code to run after the original function',
            },
            replace: {
              type: 'string',
              description: 'Code to replace the original function entirely',
            },
          },
        },
      },
      required: ['description', 'target', 'behavior'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'ai_hook_inject',
    description:
      'Inject a generated hook into the page.\n\nMethods:\n- evaluateOnNewDocument: Runs before page scripts (use for API hooks like fetch/XHR)\n- evaluate: Runs in current page context (use for hooking already-loaded code)',
    inputSchema: {
      type: 'object',
      properties: {
        hookId: {
          type: 'string',
          description: 'Hook ID returned by ai_hook_generate',
        },
        code: {
          type: 'string',
          description: 'Hook code returned by ai_hook_generate',
        },
        method: {
          type: 'string',
          enum: ['evaluateOnNewDocument', 'evaluate'],
          description: 'Injection method',
          default: 'evaluate',
        },
      },
      required: ['hookId', 'code'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'ai_hook_get_data',
    description:
      'Retrieve captured data from an active hook (arguments, return values, timestamps, call count)',
    inputSchema: {
      type: 'object',
      properties: {
        hookId: {
          type: 'string',
          description: 'Hook ID',
        },
      },
      required: ['hookId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'ai_hook_list',
    description: 'List all active hooks with their IDs, types, creation time, and call counts',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'ai_hook_clear',
    description: 'Remove one hook by ID or clear all hooks and their captured data',
    inputSchema: {
      type: 'object',
      properties: {
        hookId: {
          type: 'string',
          description: 'Hook ID to clear (omit to clear all hooks)',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'ai_hook_toggle',
    description: 'Enable or disable a hook without removing it',
    inputSchema: {
      type: 'object',
      properties: {
        hookId: {
          type: 'string',
          description: 'Hook ID',
        },
        enabled: {
          type: 'boolean',
          description: 'true to enable, false to disable',
        },
      },
      required: ['hookId', 'enabled'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'ai_hook_export',
    description: 'Export captured hook data in JSON or CSV format',
    inputSchema: {
      type: 'object',
      properties: {
        hookId: {
          type: 'string',
          description: 'Hook ID to export (omit to export all hooks)',
        },
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          description: 'Export format',
          default: 'json',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

export const hookPresetTools: Tool[] = [
  {
    name: 'hook_preset',
    description:
      'Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable hook bodies. Use listPresets=true to see all available preset descriptions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        preset: {
          type: 'string',
          description:
            'Single preset name to install. Accepts built-in preset ids or ids provided by customTemplate/customTemplates.',
        },
        presets: {
          type: 'array',
          description:
            'List of preset names to install simultaneously. Accepts built-in ids and custom template ids.',
          items: { type: 'string' },
        },
        customTemplate: {
          type: 'object',
          description:
            'Inline custom template. body should contain the hook body inserted into the standard buildHookCode wrapper. Use {{STACK_CODE}} and {{LOG_FN}} placeholders when needed.',
          properties: {
            id: {
              type: 'string',
              description: 'Stable preset id, for example deobfuscation-sinks',
            },
            description: {
              type: 'string',
              description: 'Human-readable description for listPresets output.',
            },
            body: {
              type: 'string',
              description: 'Hook body snippet inserted into the preset wrapper.',
            },
          },
          required: ['id', 'body'],
        },
        customTemplates: {
          type: 'array',
          description: 'List of inline custom templates to register for this invocation.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              description: { type: 'string' },
              body: { type: 'string' },
            },
            required: ['id', 'body'],
          },
        },
        captureStack: {
          type: 'boolean',
          description:
            'Include call stack in captured data (default: false, has performance impact).',
          default: false,
        },
        logToConsole: {
          type: 'boolean',
          description: 'Log hook events to browser console (default: true).',
          default: true,
        },
        method: {
          type: 'string',
          enum: ['evaluate', 'evaluateOnNewDocument'],
          description:
            'Injection method: evaluate=current page, evaluateOnNewDocument=before page scripts (default: evaluate).',
          default: 'evaluate',
        },
        listPresets: {
          type: 'boolean',
          description:
            'Set to true to list all available presets with descriptions instead of installing.',
          default: false,
        },
      },
      required: [],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];
