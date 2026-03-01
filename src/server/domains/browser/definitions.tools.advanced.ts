import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const advancedBrowserToolDefinitions: Tool[] = [
  {
    name: 'js_heap_search',
    description:
      'Search the browser JavaScript heap for string values matching a pattern. This is the CE (Cheat Engine) equivalent for web — scans the JS runtime memory to find tokens, API keys, signatures, or any string stored in JS objects.\n\nUSE THIS to:\n- Find auth tokens stored in memory but not in cookies/localStorage\n- Locate signing keys or secrets held in JS closures\n- Discover values that are only briefly held in memory during a request\n\nWARNING: Takes a full heap snapshot (can be 50-500MB for complex pages). Use specific patterns to reduce result noise.\nResults are paginated via DetailedDataManager when large.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'String pattern to search for in the JS heap',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of matches to return (default: 50)',
          default: 50,
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search (default: false)',
          default: false,
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'tab_workflow',
    description:
      'Cross-tab coordination for multi-page automation flows.\n\nActions:\n- list: Show all aliases and shared context\n- alias_bind: Name an existing tab by index (e.g., alias="register" index=0)\n- alias_open: Open a URL in a new tab and name it\n- navigate: Navigate a named tab to a URL\n- wait_for: Wait for selector or text to appear in a named tab\n- context_set: Store a value in shared context (accessible across tabs)\n- context_get: Read a value from shared context\n- transfer: Evaluate JS in a named tab and store result in shared context\n\nUSE THIS for:\n- Registration page ↔ email verification page workflows\n- Any flow requiring coordination between multiple open tabs',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'alias_bind', 'alias_open', 'navigate', 'wait_for', 'context_set', 'context_get', 'transfer'],
          description: 'Tab workflow action to perform',
        },
        alias: {
          type: 'string',
          description: 'Tab alias name (used by alias_bind, alias_open, navigate, wait_for, transfer)',
        },
        fromAlias: {
          type: 'string',
          description: 'Source tab alias for transfer action',
        },
        index: {
          type: 'number',
          description: 'Tab index (0-based) for alias_bind',
        },
        url: {
          type: 'string',
          description: 'URL for alias_open or navigate',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to wait for (wait_for action)',
        },
        waitForText: {
          type: 'string',
          description: 'Text string to wait for in page body (wait_for action)',
        },
        key: {
          type: 'string',
          description: 'Context key for context_set, context_get, transfer',
        },
        value: {
          description: 'Value to store (context_set action)',
        },
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate in the source tab (transfer action)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds for wait_for (default: 10000)',
          default: 10000,
        },
      },
      required: ['action'],
    },
  },

];
