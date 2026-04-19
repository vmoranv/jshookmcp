import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const extensionRegistryTools: Tool[] = [
  tool('extension_list_installed', (t) =>
    t.desc('List installed extensions from the local extension registry').query(),
  ),
  tool('extension_execute_in_context', (t) =>
    t
      .desc('Load an extension and execute a named exported context function')
      .string('pluginId', 'Plugin identifier')
      .string('contextName', 'Exported function or context name')
      .prop('args', {
        type: 'object',
        description: 'Arguments passed to the target context',
        additionalProperties: true,
      })
      .requiredOpenWorld('pluginId', 'contextName'),
  ),
  tool('extension_reload', (t) =>
    t
      .desc('Reload an installed extension by unloading and loading it again')
      .string('pluginId', 'Plugin identifier')
      .requiredOpenWorld('pluginId'),
  ),
  tool('extension_uninstall', (t) =>
    t
      .desc('Uninstall an extension from the local extension registry')
      .string('pluginId', 'Plugin identifier')
      .required('pluginId')
      .destructive(),
  ),
  tool('webhook', (t) =>
    t
      .desc(
        'Manage webhook endpoints for external callbacks. Actions: create, list, delete, commands.',
      )
      .enum('action', ['create', 'list', 'delete', 'commands'], 'Webhook operation')
      .string('name', 'Human-readable webhook name (action=create)')
      .string('path', 'URL path for the webhook endpoint (action=create)')
      .string('secret', 'Optional HMAC secret for webhook authentication (action=create)')
      .string('url', 'Optional external callback URL for webhook forwarding (action=create)')
      .array('events', { type: 'string' }, 'List of events to subscribe to (action=create)')
      .string('endpointId', 'Webhook endpoint identifier (action=delete, commands)')
      .string(
        'status',
        'Filter commands by status: pending, processing, completed, failed (action=commands)',
      )
      .prop('command', {
        type: 'object',
        description:
          'Command to enqueue (action=commands, if provided adds to queue instead of listing)',
        additionalProperties: true,
      })
      .required('action'),
  ),
];
