import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const browserPageCoreTools: Tool[] = [
  {
    name: 'page_navigate',
    description: `Navigate to a URL

Features:
- Automatic CAPTCHA detection
- Optional network monitoring (set enableNetworkMonitoring=true to auto-enable)
- Waits for page load based on waitUntil strategy

Network Monitoring:
If you want to capture network requests, you have two options:
1. Call network_enable before page_navigate (recommended for full control)
2. Set enableNetworkMonitoring=true in page_navigate (convenient for quick capture)

Example with network monitoring:
page_navigate(url="https:
-> Network monitoring auto-enabled
-> Page loads
-> Use network_get_requests to see captured requests`,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Target URL to navigate to',
        },
        waitUntil: {
          type: 'string',
          description: 'When to consider navigation succeeded',
          enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
          default: 'networkidle',
        },
        timeout: {
          type: 'number',
          description: 'Navigation timeout in milliseconds',
          default: 30000,
        },
        enableNetworkMonitoring: {
          type: 'boolean',
          description:
            ' Auto-enable network monitoring before navigation to capture all requests. If already enabled, this has no effect.',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'page_reload',
    description: 'Reload current page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'page_back',
    description: 'Navigate back in history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'page_forward',
    description: 'Navigate forward in history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'dom_query_selector',
    description:
      'Query single element (like document.querySelector). AI should use this BEFORE clicking to verify element exists.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
        getAttributes: {
          type: 'boolean',
          description: 'Whether to get element attributes',
          default: true,
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'dom_query_all',
    description: 'Query all matching elements (like document.querySelectorAll)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of elements to return',
          default: 100,
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'dom_get_structure',
    description: `Get page DOM structure (for AI to understand page layout).

IMPORTANT: Large DOM structures (>50KB) automatically return summary + detailId.

Best Practices:
1. Use maxDepth=2 for initial exploration (faster, smaller)
2. Use maxDepth=3 only when needed (may be large)
3. Set includeText=false to reduce size if text not needed

Example:
dom_get_structure(maxDepth=2, includeText=false)
-> Returns compact structure without text content`,
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          description: 'Maximum depth of DOM tree (default: 3, recommend: 2 for large pages)',
          default: 3,
        },
        includeText: {
          type: 'boolean',
          description: 'Whether to include text content (set false to reduce size)',
          default: true,
        },
      },
    },
  },
  {
    name: 'dom_find_clickable',
    description:
      'Find all clickable elements (buttons, links). Use this to discover what can be clicked.',
    inputSchema: {
      type: 'object',
      properties: {
        filterText: {
          type: 'string',
          description: 'Filter by text content (optional)',
        },
      },
    },
  },

  {
    name: 'page_click',
    description: 'Click an element. Use dom_query_selector FIRST to verify element exists.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of element to click',
        },
        button: {
          type: 'string',
          description: 'Mouse button to click',
          enum: ['left', 'right', 'middle'],
          default: 'left',
        },
        clickCount: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description: 'Number of clicks (numeric string is accepted and auto-normalized)',
          default: 1,
        },
        delay: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description:
            'Delay between mousedown and mouseup in milliseconds (numeric string is accepted)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'page_type',
    description: 'Type text into an input element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of input element',
        },
        text: {
          type: 'string',
          description: 'Text to type',
        },
        delay: {
          type: 'number',
          description: 'Delay between key presses in milliseconds',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'page_select',
    description: 'Select option(s) in a <select> element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of select element',
        },
        values: {
          type: 'array',
          description: 'Values to select',
          items: {
            type: 'string',
          },
        },
      },
      required: ['selector', 'values'],
    },
  },
  {
    name: 'page_hover',
    description: 'Hover over an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of element to hover',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'page_scroll',
    description: 'Scroll the page',
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'Horizontal scroll position',
          default: 0,
        },
        y: {
          type: 'number',
          description: 'Vertical scroll position',
          default: 0,
        },
      },
    },
  },

  {
    name: 'page_wait_for_selector',
    description: 'Wait for an element to appear',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds',
          default: 30000,
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'page_evaluate',
    description: `Execute JavaScript code in page context and get result.

IMPORTANT: Large results (>50KB) automatically return summary + detailId to prevent context overflow.
Use get_detailed_data(detailId) to retrieve full data if needed.

Best Practices:
-  Query specific properties: { hasAcrawler: !!window.byted_acrawler }
-  Return only needed data: Object.keys(window.byted_acrawler)
-  Avoid returning entire objects: window (too large!)

Example:
page_evaluate("({ keys: Object.keys(window.byted_acrawler), type: typeof window.byted_acrawler })")
-> Returns small summary
-> If you need full object, use the returned detailId`,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute',
        },
        autoSummarize: {
          type: 'boolean',
          description: 'Auto-summarize large results (default: true)',
          default: true,
        },
        maxSize: {
          type: 'number',
          description: 'Max result size in bytes before auto-summarizing (default: 50KB)',
          default: 51200,
        },
        fieldFilter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Server-side field filter: remove keys matching these names from the result object (recursive). Useful to strip noise fields like "icon", "avatar", "base64Image".',
        },
        stripBase64: {
          type: 'boolean',
          description: 'Strip data URI and bare base64 strings from the result, replacing them with a size placeholder. Prevents context overflow from embedded images/fonts (default: false).',
          default: false,
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'page_screenshot',
    description: 'Take a screenshot of the page or a specific DOM element. Pass a CSS selector to capture only that element, or omit/use "all" for full page viewport.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element to screenshot. Omit or pass "all" for full page viewport.',
        },
        path: {
          type: 'string',
          description: 'File path to save screenshot (optional)',
        },
        type: {
          type: 'string',
          description: 'Image format',
          enum: ['png', 'jpeg'],
          default: 'png',
        },
        quality: {
          type: 'number',
          description: 'Image quality (0-100, only for jpeg)',
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture full scrollable page (ignored when selector is set)',
          default: false,
        },
      },
    },
  },

  {
    name: 'get_all_scripts',
    description: 'Get list of all loaded scripts on the page',
    inputSchema: {
      type: 'object',
      properties: {
        includeSource: {
          type: 'boolean',
          description: 'Whether to include script source code',
          default: false,
        },
      },
    },
  },
  {
    name: 'get_script_source',
    description: `Get source code of a specific script.

IMPORTANT: Large scripts (>50KB) automatically return summary + detailId.
Use preview mode first to check script size before fetching full source.

Best Practices:
1. Use preview=true first to see script overview
2. If script is large, use detailId to get full source
3. Or use startLine/endLine to get specific sections

Example:
get_script_source(scriptId="abc", preview=true)
-> Returns: { lines: 5000, size: "500KB", preview: "...", detailId: "..." }
-> Then: get_detailed_data(detailId) to get full source`,
    inputSchema: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: 'Script ID from get_all_scripts',
        },
        url: {
          type: 'string',
          description: 'Script URL (supports wildcards like *.js)',
        },
        preview: {
          type: 'boolean',
          description: 'Return preview only (first 100 lines + metadata)',
          default: false,
        },
        maxLines: {
          type: 'number',
          description: 'Max lines to return in preview mode (default: 100)',
          default: 100,
        },
        startLine: {
          type: 'number',
          description: 'Start line number (1-based, for partial fetch)',
        },
        endLine: {
          type: 'number',
          description: 'End line number (1-based, for partial fetch)',
        },
      },
    },
  },

];
