import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const DEBUGGER_ADVANCED_TOOLS: Tool[] = [
  {
    name: 'watch_add',
    description: ` Add a watch expression to monitor variable values

Usage:
- Monitor key variables during debugging
- Automatically evaluate on each pause
- Track value changes over time

Example:
watch_add(expression="window.byted_acrawler", name="acrawler")`,
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression to watch (e.g., "window.obj", "arguments[0]")',
        },
        name: {
          type: 'string',
          description: 'Optional friendly name for the watch expression',
        },
      },
      required: ['expression'],
    },
  },

  {
    name: 'watch_remove',
    description: 'Remove a watch expression by ID',
    inputSchema: {
      type: 'object',
      properties: {
        watchId: {
          type: 'string',
          description: 'Watch expression ID (from watch_add or watch_list)',
        },
      },
      required: ['watchId'],
    },
  },

  {
    name: 'watch_list',
    description: 'List all watch expressions',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'watch_evaluate_all',
    description: `Evaluate all enabled watch expressions

Returns:
- Current values of all watch expressions
- Value change indicators
- Error information if evaluation fails

Best used when paused at a breakpoint.`,
    inputSchema: {
      type: 'object',
      properties: {
        callFrameId: {
          type: 'string',
          description: 'Optional call frame ID (from get_call_stack)',
        },
      },
    },
  },

  {
    name: 'watch_clear_all',
    description: 'Clear all watch expressions',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'xhr_breakpoint_set',
    description: ` Set XHR/Fetch breakpoint (pause before network requests)

Usage:
- Intercept API calls
- Debug request parameter generation
- Trace network request logic

Supports wildcard patterns:
- "*api*" - matches any URL containing "api"
- "*/aweme/v1/*" - matches specific API path
- "*" - matches all requests

Example:
xhr_breakpoint_set(urlPattern="*aweme/v1/*")`,
    inputSchema: {
      type: 'object',
      properties: {
        urlPattern: {
          type: 'string',
          description: 'URL pattern (supports wildcards *)',
        },
      },
      required: ['urlPattern'],
    },
  },

  {
    name: 'xhr_breakpoint_remove',
    description: 'Remove XHR breakpoint by ID',
    inputSchema: {
      type: 'object',
      properties: {
        breakpointId: {
          type: 'string',
          description: 'XHR breakpoint ID',
        },
      },
      required: ['breakpointId'],
    },
  },

  {
    name: 'xhr_breakpoint_list',
    description: 'List all XHR breakpoints',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'event_breakpoint_set',
    description: ` Set event listener breakpoint (pause on event)

Common event names:
- Mouse: click, dblclick, mousedown, mouseup, mousemove
- Keyboard: keydown, keyup, keypress
- Timer: setTimeout, setInterval, requestAnimationFrame
- WebSocket: message, open, close, error

Example:
event_breakpoint_set(eventName="click")
event_breakpoint_set(eventName="setTimeout")`,
    inputSchema: {
      type: 'object',
      properties: {
        eventName: {
          type: 'string',
          description: 'Event name (e.g., "click", "setTimeout")',
        },
        targetName: {
          type: 'string',
          description: 'Optional target name (e.g., "WebSocket")',
        },
      },
      required: ['eventName'],
    },
  },

  {
    name: 'event_breakpoint_set_category',
    description: `Set breakpoints for entire event category

Categories:
- mouse: All mouse events (click, mousedown, etc.)
- keyboard: All keyboard events (keydown, keyup, etc.)
- timer: All timer events (setTimeout, setInterval, etc.)
- websocket: All WebSocket events (message, open, etc.)

Example:
event_breakpoint_set_category(category="mouse")`,
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['mouse', 'keyboard', 'timer', 'websocket'],
          description: 'Event category',
        },
      },
      required: ['category'],
    },
  },

  {
    name: 'event_breakpoint_remove',
    description: 'Remove event breakpoint by ID',
    inputSchema: {
      type: 'object',
      properties: {
        breakpointId: {
          type: 'string',
          description: 'Event breakpoint ID',
        },
      },
      required: ['breakpointId'],
    },
  },

  {
    name: 'event_breakpoint_list',
    description: 'List all event breakpoints',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'blackbox_add',
    description: ` Blackbox scripts (skip during debugging)

Usage:
- Skip third-party library code
- Focus on business logic
- Improve debugging efficiency

Common patterns:
- "*jquery*.js" - jQuery
- "*react*.js" - React
- "*node_modules/*" - All npm packages
- "*webpack*" - Webpack bundles

Example:
blackbox_add(urlPattern="*node_modules/*")`,
    inputSchema: {
      type: 'object',
      properties: {
        urlPattern: {
          type: 'string',
          description: 'URL pattern to blackbox (supports wildcards *)',
        },
      },
      required: ['urlPattern'],
    },
  },

  {
    name: 'blackbox_add_common',
    description: `Blackbox all common libraries (one-click)

Includes:
- jquery, react, vue, angular
- lodash, underscore, moment
- webpack, node_modules, vendor bundles

Example:
blackbox_add_common()`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'blackbox_list',
    description: 'List all blackboxed patterns',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
