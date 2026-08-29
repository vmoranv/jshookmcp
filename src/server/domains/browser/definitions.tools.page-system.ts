import type { Tool } from '@modelcontextprotocol/server';
import { PAGE_EVAL_MAX_SIZE_BYTES } from '@src/constants/browser';
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
          default: PAGE_EVAL_MAX_SIZE_BYTES,
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
        'urls',
        { type: 'string' },
        'Optional URL scope for action=get; omitted returns all cookies via CDP',
      )
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
      .desc('Read, write, delete, or clear localStorage entries for the current origin.')
      .enum('action', ['get', 'set', 'delete', 'clear'], 'Action')
      .string('key', 'Key (for set/get/delete)')
      .string('value', 'Value (for set)')
      .required('action'),
  ),
  tool('page_session_storage', (t) =>
    t
      .desc('Read, write, delete, or clear sessionStorage entries for the current origin.')
      .enum('action', ['get', 'set', 'delete', 'clear'], 'Action')
      .string('key', 'Key (for set/get/delete)')
      .string('value', 'Value (for set)')
      .required('action'),
  ),
  tool('page_storage_info', (t) =>
    t
      .desc(
        'Query navigator.storage.estimate() for {usage, quota} and navigator.storage.persisted() ' +
          'to inspect the origin storage budget and persistence status (offline/PWA reverse engineering).',
      )
      .query(),
  ),
  tool('page_press_key', (t) =>
    t.desc('Simulate a key press by name.').string('key', 'Key name').requiredOpenWorld('key'),
  ),
  tool('page_handle_dialog', (t) =>
    t
      .desc(
        'Control how JavaScript dialogs (alert/confirm/prompt/beforeunload) are answered. ' +
          'By default installs a persistent handler that auto-dismisses all dialogs. ' +
          'Set dismissAll=false for one-shot handling of the next dialog.',
      )
      .boolean('accept', 'Accept (true) or dismiss (false) the dialog', { default: true })
      .string('promptText', 'Response text for prompt dialogs (accept must be true)')
      .boolean(
        'dismissAll',
        'Install a persistent handler that auto-dismisses all future dialogs',
        { default: false },
      )
      .idempotent(),
  ),
  tool('service_worker_deliver_push', (t) =>
    t
      .desc(
        'Deliver a synthetic push message to a service worker via CDP ' +
          'ServiceWorker.deliverPushMessage. Requires an attached CDP session on a SW target.',
      )
      .string('origin', 'Origin of the service worker registration')
      .string('registrationId', 'Service worker registration ID')
      .string('data', 'Push message payload data')
      .required('origin', 'registrationId'),
  ),
  tool('service_worker_dispatch_sync', (t) =>
    t
      .desc(
        'Dispatch a Background Sync event to a service worker via CDP ' +
          'ServiceWorker.dispatchSyncEvent. Requires an attached CDP session on a SW target.',
      )
      .string('origin', 'Origin of the service worker registration')
      .string('registrationId', 'Service worker registration ID')
      .string('tag', 'Sync tag (identifies the sync event)', { default: '' })
      .boolean('lastChance', 'Whether this is the last retry attempt', { default: false })
      .required('origin', 'registrationId'),
  ),
];
