import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserPageCoreTools: Tool[] = [
  tool('page_navigate')
    .desc(`Navigate to a URL

Features:
- Automatic CAPTCHA detection
- Optional network monitoring (set enableNetworkMonitoring=true to auto-enable)
- Waits for page load based on waitUntil strategy

Network Monitoring:
If you want to capture network requests, you have two options:
1. Call network_enable before page_navigate (recommended for full control)
2. Set enableNetworkMonitoring=true in page_navigate (convenient for quick capture)

Example with network monitoring:
page_navigate(url="https:")
-> Network monitoring auto-enabled
-> Page loads
-> Use network_get_requests to see captured requests`)
    .string('url', 'Target URL to navigate to')
    .enum('waitUntil', ['load', 'domcontentloaded', 'networkidle', 'commit'], 'When to consider navigation succeeded', { default: 'networkidle' })
    .number('timeout', 'Navigation timeout in milliseconds', { default: 30000 })
    .boolean('enableNetworkMonitoring', 'Auto-enable network monitoring before navigation to capture all requests. If already enabled, this has no effect.', { default: false })
    .required('url')
    .idempotent()
    .openWorld()
    .build(),

  tool('page_reload')
    .desc('Reload current page')
    .idempotent()
    .openWorld()
    .build(),

  tool('page_back')
    .desc('Navigate back in history')
    .openWorld()
    .build(),

  tool('page_forward')
    .desc('Navigate forward in history')
    .openWorld()
    .build(),

  tool('dom_query_selector')
    .desc('Query single element (like document.querySelector). AI should use this BEFORE clicking to verify element exists.')
    .string('selector', 'CSS selector')
    .boolean('getAttributes', 'Whether to get element attributes', { default: true })
    .required('selector')
    .readOnly()
    .idempotent()
    .build(),

  tool('dom_query_all')
    .desc('Query all matching elements (like document.querySelectorAll)')
    .string('selector', 'CSS selector')
    .number('limit', 'Maximum number of elements to return', { default: 100 })
    .required('selector')
    .readOnly()
    .idempotent()
    .build(),

  tool('dom_get_structure')
    .desc(`Get page DOM structure (for AI to understand page layout).

IMPORTANT: Large DOM structures (>50KB) automatically return summary + detailId.

Best Practices:
1. Use maxDepth=2 for initial exploration (faster, smaller)
2. Use maxDepth=3 only when needed (may be large)
3. Set includeText=false to reduce size if text not needed

Example:
dom_get_structure(maxDepth=2, includeText=false)
-> Returns compact structure without text content`)
    .number('maxDepth', 'Maximum depth of DOM tree (default: 3, recommend: 2 for large pages)', { default: 3 })
    .boolean('includeText', 'Whether to include text content (set false to reduce size)', { default: true })
    .readOnly()
    .idempotent()
    .build(),

  tool('dom_find_clickable')
    .desc('Find all clickable elements (buttons, links). Use this to discover what can be clicked.')
    .string('filterText', 'Filter by text content (optional)')
    .readOnly()
    .idempotent()
    .build(),

  tool('page_click')
    .desc('Click an element. Use dom_query_selector FIRST to verify element exists.')
    .string('selector', 'CSS selector of element to click')
    .enum('button', ['left', 'right', 'middle'], 'Mouse button to click', { default: 'left' })
    .number('clickCount', 'Number of clicks (numeric string is accepted and auto-normalized)', { default: 1 })
    .number('delay', 'Delay between mousedown and mouseup in milliseconds (numeric string is accepted)')
    .required('selector')
    .openWorld()
    .build(),

  tool('page_type')
    .desc('Type text into an input element')
    .string('selector', 'CSS selector of input element')
    .string('text', 'Text to type')
    .number('delay', 'Delay between key presses in milliseconds')
    .required('selector', 'text')
    .openWorld()
    .build(),

  tool('page_select')
    .desc('Select option(s) in a <select> element')
    .string('selector', 'CSS selector of select element')
    .array('values', { type: 'string' }, 'Values to select')
    .required('selector', 'values')
    .idempotent()
    .openWorld()
    .build(),

  tool('page_hover')
    .desc('Hover over an element')
    .string('selector', 'CSS selector of element to hover')
    .required('selector')
    .idempotent()
    .openWorld()
    .build(),

  tool('page_scroll')
    .desc('Scroll the page')
    .number('x', 'Horizontal scroll position', { default: 0 })
    .number('y', 'Vertical scroll position', { default: 0 })
    .idempotent()
    .build(),

  tool('page_wait_for_selector')
    .desc('Wait for an element to appear')
    .string('selector', 'CSS selector to wait for')
    .number('timeout', 'Timeout in milliseconds', { default: 30000 })
    .required('selector')
    .readOnly()
    .idempotent()
    .build(),

  tool('page_evaluate')
    .desc(`Execute JavaScript code in page context and get result.

IMPORTANT: Large results (>50KB) automatically return summary + detailId to prevent context overflow.
Use get_detailed_data(detailId) to retrieve full data if needed.

Best Practices:
-  Query specific properties: { hasAcrawler: !!window.byted_acrawler }
-  Return only needed data: Object.keys(window.byted_acrawler)
-  Avoid returning entire objects: window (too large!)

Example:
page_evaluate("({ keys: Object.keys(window.byted_acrawler), type: typeof window.byted_acrawler })")
-> Returns small summary
-> If you need full object, use the returned detailId`)
    .string('code', 'JavaScript code to execute')
    .boolean('autoSummarize', 'Auto-summarize large results (default: true)', { default: true })
    .number('maxSize', 'Max result size in bytes before auto-summarizing (default: 50KB)', { default: 51200 })
    .array('fieldFilter', { type: 'string' }, 'Server-side field filter: remove keys matching these names from the result object (recursive). Useful to strip noise fields like "icon", "avatar", "base64Image".')
    .boolean('stripBase64', 'Strip data URI and bare base64 strings from the result, replacing them with a size placeholder. Prevents context overflow from embedded images/fonts (default: false).', { default: false })
    .required('code')
    .openWorld()
    .build(),

  tool('page_screenshot')
    .desc(`Take a screenshot of the page, a specific DOM element, multiple elements, or a pixel region.

Modes:
- Full page: omit selector or pass "all"
- Single element: selector = ".my-class"
- Multiple elements: selector = [".header", "#main", ".footer"] — returns one screenshot per element
- Pixel region: pass clip = {x, y, width, height} (ignored when selector is set)`)
    .prop('selector', {
      oneOf: [
        { type: 'string', description: 'Single CSS selector' },
        { type: 'array', items: { type: 'string' }, description: 'Array of CSS selectors for batch element screenshots' }
      ],
      description: 'CSS selector(s) of the element(s) to screenshot. Omit or pass "all" for full page viewport.',
    })
    .object('clip', {
      x: { type: 'number', description: 'Left offset in pixels' },
      y: { type: 'number', description: 'Top offset in pixels' },
      width: { type: 'number', description: 'Region width in pixels' },
      height: { type: 'number', description: 'Region height in pixels' },
    }, 'Pixel region to capture (ignored when selector is set)', { required: ['x', 'y', 'width', 'height'] })
    .string('path', 'File path to save screenshot (optional). For batch mode, used as directory or base name.')
    .enum('type', ['png', 'jpeg'], 'Image format', { default: 'png' })
    .number('quality', 'Image quality (0-100, only for jpeg)')
    .boolean('fullPage', 'Capture full scrollable page (ignored when selector or clip is set)', { default: false })
    .readOnly()
    .idempotent()
    .build(),

  tool('get_all_scripts')
    .desc('Get list of all loaded scripts on the page')
    .boolean('includeSource', 'Whether to include script source code', { default: false })
    .readOnly()
    .idempotent()
    .build(),

  tool('get_script_source')
    .desc(`Get source code of a specific script.

IMPORTANT: Large scripts (>50KB) automatically return summary + detailId.
Use preview mode first to check script size before fetching full source.

Best Practices:
1. Use preview=true first to see script overview
2. If script is large, use detailId to get full source
3. Or use startLine/endLine to get specific sections

Example:
get_script_source(scriptId="abc", preview=true)
-> Returns: { lines: 5000, size: "500KB", preview: "...", detailId: "..." }
-> Then: get_detailed_data(detailId) to get full source`)
    .string('scriptId', 'Script ID from get_all_scripts')
    .string('url', 'Script URL (supports wildcards like *.js)')
    .boolean('preview', 'Return preview only (first 100 lines + metadata)', { default: false })
    .number('maxLines', 'Max lines to return in preview mode (default: 100)', { default: 100 })
    .number('startLine', 'Start line number (1-based, for partial fetch)')
    .number('endLine', 'End line number (1-based, for partial fetch)')
    .readOnly()
    .idempotent()
    .build()
];
