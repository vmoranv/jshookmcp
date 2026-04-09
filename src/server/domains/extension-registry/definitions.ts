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
  tool('extension_install', (t) =>
    t
      .desc('Install an extension from a local or remote manifest/module URL')
      .string('url', 'Manifest URL or module URL')
      .requiredOpenWorld('url'),
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
  tool('webhook_create', (t) =>
    t
      .desc('Create a new webhook endpoint for external callbacks')
      .string('name', 'Human-readable webhook name')
      .string('path', 'URL path for the webhook endpoint (e.g. /c2)')
      .string('secret', 'Optional HMAC secret for webhook authentication')
      .string('url', 'Optional external callback URL for webhook forwarding')
      .array('events', { type: 'string' }, 'List of events to subscribe to')
      .requiredOpenWorld('name', 'path'),
  ),
  tool('webhook_list', (t) => t.desc('List all registered webhook endpoints').query()),
  tool('webhook_delete', (t) =>
    t
      .desc('Delete a webhook endpoint by ID')
      .string('endpointId', 'Webhook endpoint identifier')
      .required('endpointId')
      .destructive(),
  ),
  tool('webhook_commands', (t) =>
    t
      .desc('Get or set commands queued for a webhook endpoint')
      .string('endpointId', 'Webhook endpoint identifier')
      .string('status', 'Filter commands by status (pending, processing, completed, failed)')
      .prop('command', {
        type: 'object',
        description: 'Command to enqueue (if provided, adds to queue instead of listing)',
        additionalProperties: true,
      })
      .required('endpointId')
      .readOnly(),
  ),
];
