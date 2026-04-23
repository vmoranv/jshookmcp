import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserPageCoreTools: Tool[] = [
  tool('page_navigate', (t) =>
    t
      .desc('Navigate to a URL.')
      .string('url', 'Target URL')
      .enum(
        'waitUntil',
        ['load', 'domcontentloaded', 'networkidle', 'commit'],
        'When to consider navigation succeeded',
        { default: 'networkidle' },
      )
      .number('timeout', 'Navigation timeout in ms', {
        default: 30000,
        minimum: 1000,
        maximum: 120000,
      })
      .boolean('enableNetworkMonitoring', 'Enable network monitoring before navigation', {
        default: false,
      })
      .required('url')
      .idempotent()
      .openWorld(),
  ),
  tool('page_reload', (t) => t.desc('Reload current page').idempotent().openWorld()),
  tool('page_back', (t) => t.desc('Go back in history').openWorld()),
  tool('page_forward', (t) => t.desc('Go forward in history').openWorld()),
  tool('page_click', (t) =>
    t
      .desc('Click an element.')
      .string('selector', 'CSS selector')
      .enum('button', ['left', 'right', 'middle'], 'Mouse button', { default: 'left' })
      .number('clickCount', 'Number of clicks', {
        default: 1,
        minimum: 1,
        maximum: 10,
      })
      .number('delay', 'Delay between mousedown and mouseup in ms', {
        minimum: 0,
        maximum: 10000,
      })
      .string('frameUrl', 'iframe URL substring')
      .string('frameSelector', 'iframe CSS selector')
      .requiredOpenWorld('selector'),
  ),
  tool('page_type', (t) =>
    t
      .desc('Type text into an element.')
      .string('selector', 'CSS selector')
      .string('text', 'Text to type')
      .number('delay', 'Delay between key presses in ms', { minimum: 0, maximum: 1000 })
      .string('frameUrl', 'iframe URL substring')
      .string('frameSelector', 'iframe CSS selector')
      .requiredOpenWorld('selector', 'text'),
  ),
  tool('page_select', (t) =>
    t
      .desc('Select option(s) in a <select> element.')
      .string('selector', 'CSS selector')
      .array('values', { type: 'string' }, 'Values to select')
      .string('frameUrl', 'iframe URL substring')
      .string('frameSelector', 'iframe CSS selector')
      .required('selector', 'values')
      .idempotent()
      .openWorld(),
  ),
  tool('page_hover', (t) =>
    t
      .desc('Hover over an element.')
      .string('selector', 'CSS selector')
      .string('frameUrl', 'iframe URL substring')
      .string('frameSelector', 'iframe CSS selector')
      .required('selector')
      .idempotent()
      .openWorld(),
  ),
  tool('page_scroll', (t) =>
    t
      .desc('Scroll the page.')
      .number('x', 'Horizontal position', { default: 0 })
      .number('y', 'Vertical position', { default: 0 })
      .idempotent(),
  ),
  tool('page_wait_for_selector', (t) =>
    t
      .desc('Wait for an element to appear.')
      .string('selector', 'CSS selector')
      .number('timeout', 'Timeout in ms', {
        default: 30000,
        minimum: 1000,
        maximum: 120000,
      })
      .required('selector')
      .query(),
  ),
  tool('page_evaluate', (t) =>
    t
      .desc('Execute JavaScript in page context.')
      .string('code', 'JavaScript code')
      .boolean('autoSummarize', 'Auto-summarize large results', { default: true })
      .number('maxSize', 'Max result size in bytes before summarizing', {
        default: 51200,
        minimum: 1024,
        maximum: 10485760,
      })
      .array('fieldFilter', { type: 'string' }, 'Field names to strip from result (recursive)')
      .boolean('stripBase64', 'Strip base64 strings from result', { default: false })
      .string('frameUrl', 'iframe URL substring')
      .string('frameSelector', 'iframe CSS selector')
      .requiredOpenWorld('code'),
  ),
  tool('page_screenshot', (t) =>
    t
      .desc('Take a screenshot.')
      .prop('selector', {
        oneOf: [
          { type: 'string', description: 'CSS selector' },
          {
            type: 'array',
            items: { type: 'string' },
            description: 'Multiple CSS selectors',
          },
        ],
        description: 'Element selector(s). Omit for full page viewport.',
      })
      .object(
        'clip',
        {
          x: { type: 'number', description: 'Left offset' },
          y: { type: 'number', description: 'Top offset' },
          width: { type: 'number', description: 'Width' },
          height: { type: 'number', description: 'Height' },
        },
        'Pixel region to capture',
        { required: ['x', 'y', 'width', 'height'] },
      )
      .string('path', 'File path to save screenshot')
      .enum('type', ['png', 'jpeg'], 'Image format', { default: 'png' })
      .number('quality', 'Image quality 0-100 (jpeg only)', { minimum: 1, maximum: 100 })
      .boolean('fullPage', 'Capture full scrollable page', { default: false })
      .query(),
  ),
  tool('get_all_scripts', (t) =>
    t
      .desc('List all loaded scripts.')
      .boolean('includeSource', 'Include source code', { default: false })
      .query(),
  ),
  tool('get_script_source', (t) =>
    t
      .desc('Get source code of a script.')
      .string('scriptId', 'Script ID')
      .string('url', 'Script URL (supports wildcards)')
      .boolean('preview', 'Preview only (first N lines + metadata)', { default: false })
      .number('maxLines', 'Max lines in preview', {
        default: 100,
        minimum: 1,
        maximum: 10000,
      })
      .number('startLine', 'Start line (1-based)', { minimum: 1 })
      .number('endLine', 'End line (1-based)', { minimum: 1 })
      .query(),
  ),
];
