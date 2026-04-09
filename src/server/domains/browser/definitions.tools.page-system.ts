import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserPageSystemTools: Tool[] = [
  tool('console_enable', (t) =>
    t.desc('Enable console monitoring to capture console.log, console.error, etc.').idempotent(),
  ),
  tool('console_get_logs', (t) =>
    t
      .desc('Get captured console logs')
      .enum('type', ['log', 'warn', 'error', 'info', 'debug'], 'Filter by log type')
      .number('limit', 'Maximum number of logs to return')
      .number('since', 'Only return logs after this timestamp')
      .query(),
  ),
  tool('console_execute', (t) =>
    t
      .desc('Execute JavaScript expression in console context')
      .string('expression', 'JavaScript expression to execute')
      .requiredOpenWorld('expression'),
  ),
  tool('dom_get_computed_style', (t) =>
    t
      .desc('Get computed CSS styles of an element')
      .string('selector', 'CSS selector')
      .required('selector')
      .query(),
  ),
  tool('dom_find_by_text', (t) =>
    t
      .desc('Find elements by text content (useful for dynamic content)')
      .string('text', 'Text to search for')
      .string('tag', 'Optional tag name to filter (e.g., "button", "a")')
      .required('text')
      .query(),
  ),
  tool('dom_get_xpath', (t) =>
    t
      .desc('Get XPath of an element')
      .string('selector', 'CSS selector')
      .required('selector')
      .query(),
  ),
  tool('dom_is_in_viewport', (t) =>
    t
      .desc('Check if element is visible in viewport')
      .string('selector', 'CSS selector')
      .required('selector')
      .query(),
  ),
  tool('page_get_performance', (t) =>
    t.desc('Get page performance metrics (load time, network time, etc.)').query(),
  ),
  tool('page_inject_script', (t) =>
    t
      .desc('Inject JavaScript code into page')
      .string('script', 'JavaScript code to inject')
      .requiredOpenWorld('script'),
  ),
  tool('page_set_cookies', (t) =>
    t
      .desc('Set cookies for the page')
      .array(
        'cookies',
        {
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
        'Array of cookie objects',
      )
      .required('cookies')
      .idempotent(),
  ),
  tool('page_get_cookies', (t) => t.desc('Get all cookies for the page').query()),
  tool('page_clear_cookies', (t) => t.desc('Clear all cookies').resettable()),
  tool('page_set_viewport', (t) =>
    t
      .desc('Set viewport size')
      .number('width', 'Viewport width')
      .number('height', 'Viewport height')
      .required('width', 'height')
      .idempotent(),
  ),
  tool('page_emulate_device', (t) =>
    t
      .desc('Emulate mobile device (iPhone, iPad, Android)')
      .string(
        'device',
        'Device to emulate. Supports canonical values (iPhone, iPad, Android) and aliases like "iPhone 13" / "iPhone 14".',
      )
      .required('device')
      .idempotent(),
  ),
  tool('page_get_local_storage', (t) => t.desc('Get all localStorage items').query()),
  tool('page_set_local_storage', (t) =>
    t
      .desc('Set localStorage item')
      .string('key', 'Storage key')
      .string('value', 'Storage value')
      .required('key', 'value')
      .idempotent(),
  ),
  tool('page_press_key', (t) =>
    t
      .desc('Press a keyboard key (e.g., "Enter", "Escape", "ArrowDown")')
      .string('key', 'Key to press')
      .requiredOpenWorld('key'),
  ),
  tool('page_get_all_links', (t) => t.desc('Get all links on the page').query()),
];
