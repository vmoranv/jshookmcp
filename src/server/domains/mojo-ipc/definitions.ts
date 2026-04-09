import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const mojoIpcTools: Tool[] = [
  tool('mojo_monitor_start', (t) =>
    t
      .desc('Start Mojo IPC monitoring for the active Chromium-based target')
      .string('deviceId', 'Optional device or transport identifier'),
  ),
  tool('mojo_monitor_stop', (t) => t.desc('Stop the active Mojo IPC monitoring session')),
  tool('mojo_decode_message', (t) =>
    t
      .desc('Decode a Mojo IPC hex payload into a structured field map')
      .string('hexPayload', 'Hex-encoded Mojo IPC payload')
      .required('hexPayload')
      .query(),
  ),
  tool('mojo_list_interfaces', (t) =>
    t.desc('List discovered Mojo IPC interfaces and their pending message counts').query(),
  ),
  tool('mojo_messages_get', (t) =>
    t
      .desc('Retrieve captured Mojo IPC messages from the active monitoring session')
      .number('limit', 'Maximum number of messages to retrieve (default 100)')
      .string('interface', 'Filter messages by interface name')
      .query(),
  ),
];
