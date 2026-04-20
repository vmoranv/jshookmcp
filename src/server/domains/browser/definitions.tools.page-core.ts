import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserPageCoreTools: Tool[] = [
  tool('page_navigate', (t) =>
    t
      .desc(`Navigate to a URL. Supports auto CAPTCHA detection and optional network monitoring.`)
      .string('url', 'Target URL to navigate to')
      .enum(
        'waitUntil',
        ['load', 'domcontentloaded', 'networkidle', 'commit'],
        'When to consider navigation succeeded',
        { default: 'networkidle' },
      )
      .number('timeout', 'Navigation timeout in milliseconds', { default: 30000 })
      .boolean(
        'enableNetworkMonitoring',
        'Auto-enable network monitoring before navigation to capture all requests. If already enabled, this has no effect.',
        { default: false },
      )
      .required('url')
      .idempotent()
      .openWorld(),
  ),
  tool('page_reload', (t) => t.desc('Reload current page').idempotent().openWorld()),
  tool('page_back', (t) => t.desc('Navigate back in history').openWorld()),
  tool('page_forward', (t) => t.desc('Navigate forward in history').openWorld()),
  tool('page_click', (t) =>
    t
      .desc('Click an element. Supports iframes via frameUrl/frameSelector.')
      .string('selector', 'CSS selector of element to click')
      .enum('button', ['left', 'right', 'middle'], 'Mouse button to click', { default: 'left' })
      .number('clickCount', 'Number of clicks (numeric string is accepted and auto-normalized)', {
        default: 1,
      })
      .number(
        'delay',
        'Delay between mousedown and mouseup in milliseconds (numeric string is accepted)',
      )
      .string('frameUrl', 'Target iframe by URL substring match (e.g. "payment.example.com")')
      .string(
        'frameSelector',
        'Target iframe by CSS selector of the iframe element (e.g. "#payment-frame")',
      )
      .requiredOpenWorld('selector'),
  ),
  tool('page_type', (t) =>
    t
      .desc(
        'Type text into an input element. Supports typing inside iframes via frameUrl/frameSelector.',
      )
      .string('selector', 'CSS selector of input element')
      .string('text', 'Text to type')
      .number('delay', 'Delay between key presses in milliseconds')
      .string('frameUrl', 'Target iframe by URL substring match')
      .string('frameSelector', 'Target iframe by CSS selector of the iframe element')
      .requiredOpenWorld('selector', 'text'),
  ),
  tool('page_select', (t) =>
    t
      .desc('Select option(s) in a <select> element. Supports iframes via frameUrl/frameSelector.')
      .string('selector', 'CSS selector of select element')
      .array('values', { type: 'string' }, 'Values to select')
      .string('frameUrl', 'Target iframe by URL substring match')
      .string('frameSelector', 'Target iframe by CSS selector of the iframe element')
      .required('selector', 'values')
      .idempotent()
      .openWorld(),
  ),
  tool('page_hover', (t) =>
    t
      .desc('Hover over an element. Supports iframes via frameUrl/frameSelector.')
      .string('selector', 'CSS selector of element to hover')
      .string('frameUrl', 'Target iframe by URL substring match')
      .string('frameSelector', 'Target iframe by CSS selector of the iframe element')
      .required('selector')
      .idempotent()
      .openWorld(),
  ),
  tool('page_scroll', (t) =>
    t
      .desc('Scroll the page')
      .number('x', 'Horizontal scroll position', { default: 0 })
      .number('y', 'Vertical scroll position', { default: 0 })
      .idempotent(),
  ),
  tool('page_wait_for_selector', (t) =>
    t
      .desc('Wait for an element to appear')
      .string('selector', 'CSS selector to wait for')
      .number('timeout', 'Timeout in milliseconds', { default: 30000 })
      .required('selector')
      .query(),
  ),
  tool('page_evaluate', (t) =>
    t
      .desc(
        `Execute JavaScript in page context. Large results (>50KB) auto-return summary + detailId.`,
      )
      .string('code', 'JavaScript code to execute')
      .boolean('autoSummarize', 'Auto-summarize large results (default: true)', { default: true })
      .number('maxSize', 'Max result size in bytes before auto-summarizing (default: 50KB)', {
        default: 51200,
      })
      .array(
        'fieldFilter',
        { type: 'string' },
        'Server-side field filter: remove keys matching these names from the result object (recursive). Useful to strip noise fields like "icon", "avatar", "base64Image".',
      )
      .boolean(
        'stripBase64',
        'Strip data URI and bare base64 strings from the result, replacing them with a size placeholder. Prevents context overflow from embedded images/fonts (default: false).',
        { default: false },
      )
      .string(
        'frameUrl',
        'Execute in a child iframe matching this URL substring (e.g. "payment.example.com")',
      )
      .string(
        'frameSelector',
        'Execute in a child iframe identified by this CSS selector (e.g. "#payment-frame")',
      )
      .requiredOpenWorld('code'),
  ),
  tool('page_screenshot', (t) =>
    t
      .desc(`Take a screenshot: full page, element(s), or pixel region.`)
      .prop('selector', {
        oneOf: [
          { type: 'string', description: 'Single CSS selector' },
          {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of CSS selectors for batch element screenshots',
          },
        ],

        description:
          'CSS selector(s) of the element(s) to screenshot. Omit or pass "all" for full page viewport.',
      })
      .object(
        'clip',
        {
          x: { type: 'number', description: 'Left offset in pixels' },
          y: { type: 'number', description: 'Top offset in pixels' },
          width: { type: 'number', description: 'Region width in pixels' },
          height: { type: 'number', description: 'Region height in pixels' },
        },
        'Pixel region to capture (ignored when selector is set)',
        { required: ['x', 'y', 'width', 'height'] },
      )
      .string(
        'path',
        'File path to save screenshot (optional). For batch mode, used as directory or base name.',
      )
      .enum('type', ['png', 'jpeg'], 'Image format', { default: 'png' })
      .number('quality', 'Image quality (0-100, only for jpeg)')
      .boolean('fullPage', 'Capture full scrollable page (ignored when selector or clip is set)', {
        default: false,
      })
      .query(),
  ),
  tool('get_all_scripts', (t) =>
    t
      .desc('Get list of all loaded scripts on the page')
      .boolean('includeSource', 'Whether to include script source code', { default: false })
      .query(),
  ),
  tool('get_script_source', (t) =>
    t
      .desc(`Get source code of a specific script. Large scripts auto-return summary + detailId.`)
      .string('scriptId', 'Script ID from get_all_scripts')
      .string('url', 'Script URL (supports wildcards like *.js)')
      .boolean('preview', 'Return preview only (first 100 lines + metadata)', { default: false })
      .number('maxLines', 'Max lines to return in preview mode (default: 100)', { default: 100 })
      .number('startLine', 'Start line number (1-based, for partial fetch)')
      .number('endLine', 'End line number (1-based, for partial fetch)')
      .query(),
  ),
];
