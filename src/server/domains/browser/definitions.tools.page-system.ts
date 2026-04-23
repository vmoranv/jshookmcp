import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserPageSystemTools: Tool[] = [
  tool('console_monitor', (t) =>
    t
      .desc('Enable or disable console monitoring.')
      .enum('action', ['enable', 'disable'], 'Action')
      .required('action')
      .idempotent(),
  ),
  tool('console_get_logs', (t) =>
    t
      .desc('Get captured console logs.')
      .enum('type', ['log', 'warn', 'error', 'info', 'debug'], 'Log type filter')
      .number('limit', 'Max logs')
      .number('since', 'Timestamp filter')
      .query(),
  ),
  tool('console_execute', (t) =>
    t
      .desc('Execute JS in console context.')
      .string('expression', 'JavaScript expression')
      .requiredOpenWorld('expression'),
  ),
  tool('page_inject_script', (t) =>
    t
      .desc('Inject JS into the page.')
      .string('script', 'JavaScript code')
      .requiredOpenWorld('script'),
  ),
  tool('page_cookies', (t) =>
    t
      .desc('Manage page cookies. Clear requires expectedCount (call get first).')
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
      .desc('Set viewport size.')
      .number('width', 'Width')
      .number('height', 'Height')
      .required('width', 'height')
      .idempotent(),
  ),
  tool('page_emulate_device', (t) =>
    t
      .desc('Emulate a mobile device.')
      .string('device', 'Device name')
      .required('device')
      .idempotent(),
  ),
  tool('page_local_storage', (t) =>
    t
      .desc('Manage localStorage.')
      .enum('action', ['get', 'set'], 'Action')
      .string('key', 'Key')
      .string('value', 'Value')
      .required('action'),
  ),
  tool('page_press_key', (t) =>
    t.desc('Press a keyboard key.').string('key', 'Key name').requiredOpenWorld('key'),
  ),
];
