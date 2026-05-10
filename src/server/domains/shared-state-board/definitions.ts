import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const sharedStateBoardTools: Tool[] = [
  tool('state_board', (t) =>
    t
      .desc('CRUD operations on the cross-tool shared state board.')
      .enum('action', ['set', 'get', 'delete', 'list', 'history', 'clear'], 'Operation to perform')
      .string('key', 'Key name (required for set/get/delete/history)')
      .prop('value', {
        type: 'object',
        description: 'Value to store',
      })
      .string('namespace', 'Namespace for key isolation')
      .number('ttlSeconds', 'TTL in seconds')
      .boolean('includeValues', 'Include current values in list results', {
        default: false,
      })
      .number('limit', 'Maximum history entries to return', { default: 50 })
      .string('keyPattern', 'Key pattern filter')
      .required('action'),
  ),
  tool('state_board_watch', (t) =>
    t
      .desc('Watch state board keys for changes with configurable polling.')
      .enum(
        'action',
        ['start', 'poll', 'stop'],
        'Watch operation: start watching, poll for changes, or stop watching',
      )
      .string('key', 'Key or pattern to watch')
      .string('namespace', 'Namespace')
      .number('pollIntervalMs', 'Polling interval in milliseconds')
      .string('watchId', 'Watch ID')
      .required('action'),
  ),
  tool('state_board_io', (t) =>
    t
      .desc('Serialize state board to JSON or restore from a previous export.')
      .enum('action', ['export', 'import'], 'IO operation')
      .string('namespace', 'Namespace filter or target namespace')
      .string('keyPattern', 'Key pattern filter')
      .prop('data', {
        type: 'object',
        description: 'Entries to import',
      })
      .boolean('overwrite', 'Overwrite existing keys on import')
      .required('action'),
  ),
];
