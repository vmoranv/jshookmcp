import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserPageSystemTools: Tool[] = [
  tool('console_monitor', (t) =>
    t
      .desc('Toggle console log capture (log, warn, error, info, debug).')
      .enum('action', ['enable', 'disable'], 'Action')
      .required('action')
      .idempotent(),
  ),
  tool('console_get_logs', (t) =>
    t
      .desc('Retrieve captured console logs with type and time filters.')
      .enum('type', ['log', 'warn', 'error', 'info', 'debug'], 'Log type filter')
      .number('limit', 'Max logs')
      .number('since', 'Timestamp filter')
      .query(),
  ),
  tool('console_execute', (t) =>
    t
      .desc('Evaluate a JS expression in the browser console context.')
      .string('expression', 'JavaScript expression')
      .number(
        'maxSize',
        'Max result size in bytes before offloading (default 50KB → detailId ref)',
        {
          default: 51200,
          minimum: 1024,
          maximum: 104857600,
        },
      )
      .boolean('stripBase64', 'Strip base64 strings from result', { default: false })
      .requiredOpenWorld('expression'),
  ),
  tool('page_inject_script', (t) =>
    t
      .desc('Inject JavaScript to run on every page load.')
      .string('script', 'JavaScript code')
      .requiredOpenWorld('script'),
  ),
  tool('page_cookies', (t) =>
    t
      .desc('Manage page cookies; clear requires matching expectedCount.')
      .enum('action', ['get', 'set', 'clear'], 'Action')
      .number('expectedCount', 'Required for clear: must match current count')
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
        'Cookies (action=set)',
      )
      .destructive()
      .required('action'),
  ),
  tool('page_set_viewport', (t) =>
    t
      .desc('Set the browser viewport dimensions.')
      .number('width', 'Width')
      .number('height', 'Height')
      .required('width', 'height')
      .idempotent(),
  ),
  tool('page_emulate_device', (t) =>
    t
      .desc('Emulate a mobile device profile.')
      .string('device', 'Device name')
      .required('device')
      .idempotent(),
  ),
  tool('page_local_storage', (t) =>
    t
      .desc('Read or write localStorage entries for the current origin.')
      .enum('action', ['get', 'set'], 'Action')
      .string('key', 'Key')
      .string('value', 'Value')
      .required('action'),
  ),
  tool('page_press_key', (t) =>
    t.desc('Simulate a key press by name.').string('key', 'Key name').requiredOpenWorld('key'),
  ),
];
