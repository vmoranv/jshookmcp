import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserPageSystemTools: Tool[] = [
  tool('console_enable')
    .desc('Enable console monitoring to capture console.log, console.error, etc.')
    .idempotent()
    .build(),

  tool('console_get_logs')
    .desc('Get captured console logs')
    .enum('type', ['log', 'warn', 'error', 'info', 'debug'], 'Filter by log type')
    .number('limit', 'Maximum number of logs to return')
    .number('since', 'Only return logs after this timestamp')
    .readOnly()
    .idempotent()
    .build(),

  tool('console_execute')
    .desc('Execute JavaScript expression in console context')
    .string('expression', 'JavaScript expression to execute')
    .required('expression')
    .openWorld()
    .build(),

  tool('dom_get_computed_style')
    .desc('Get computed CSS styles of an element')
    .string('selector', 'CSS selector')
    .required('selector')
    .readOnly()
    .idempotent()
    .build(),

  tool('dom_find_by_text')
    .desc('Find elements by text content (useful for dynamic content)')
    .string('text', 'Text to search for')
    .string('tag', 'Optional tag name to filter (e.g., "button", "a")')
    .required('text')
    .readOnly()
    .idempotent()
    .build(),

  tool('dom_get_xpath')
    .desc('Get XPath of an element')
    .string('selector', 'CSS selector')
    .required('selector')
    .readOnly()
    .idempotent()
    .build(),

  tool('dom_is_in_viewport')
    .desc('Check if element is visible in viewport')
    .string('selector', 'CSS selector')
    .required('selector')
    .readOnly()
    .idempotent()
    .build(),

  tool('page_get_performance')
    .desc('Get page performance metrics (load time, network time, etc.)')
    .readOnly()
    .idempotent()
    .build(),

  tool('page_inject_script')
    .desc('Inject JavaScript code into page')
    .string('script', 'JavaScript code to inject')
    .required('script')
    .openWorld()
    .build(),

  tool('page_set_cookies')
    .desc('Set cookies for the page')
    .array('cookies', {
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
    }, 'Array of cookie objects')
    .required('cookies')
    .idempotent()
    .build(),

  tool('page_get_cookies')
    .desc('Get all cookies for the page')
    .readOnly()
    .idempotent()
    .build(),

  tool('page_clear_cookies')
    .desc('Clear all cookies')
    .destructive()
    .idempotent()
    .build(),

  tool('page_set_viewport')
    .desc('Set viewport size')
    .number('width', 'Viewport width')
    .number('height', 'Viewport height')
    .required('width', 'height')
    .idempotent()
    .build(),

  tool('page_emulate_device')
    .desc('Emulate mobile device (iPhone, iPad, Android)')
    .string('device', 'Device to emulate. Supports canonical values (iPhone, iPad, Android) and aliases like "iPhone 13" / "iPhone 14".')
    .required('device')
    .idempotent()
    .build(),

  tool('page_get_local_storage')
    .desc('Get all localStorage items')
    .readOnly()
    .idempotent()
    .build(),

  tool('page_set_local_storage')
    .desc('Set localStorage item')
    .string('key', 'Storage key')
    .string('value', 'Storage value')
    .required('key', 'value')
    .idempotent()
    .build(),

  tool('page_press_key')
    .desc('Press a keyboard key (e.g., "Enter", "Escape", "ArrowDown")')
    .string('key', 'Key to press')
    .required('key')
    .openWorld()
    .build(),

  tool('page_get_all_links')
    .desc('Get all links on the page')
    .readOnly()
    .idempotent()
    .build(),
];
