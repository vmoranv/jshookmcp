import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const sharedStateBoardTools: Tool[] = [
  tool('state_board_set', (t) =>
    t
      .desc('Set a value in the shared state board.')
      .prop('value', {
        type: 'object',
        description: 'The value to store (any JSON-serializable type)',
      })
      .string('namespace', 'Optional namespace for key isolation (default: "default")')
      .number('ttlSeconds', 'Optional TTL in seconds (value expires after this duration)')
      .required('key', 'value'),
  ),
  tool('state_board_get', (t) =>
    t
      .desc('Get a value from the shared state board by key.')
      .string('key', 'The key to retrieve')
      .string('namespace', 'Optional namespace (default: "default")')
      .query()
      .required('key'),
  ),
  tool('state_board_delete', (t) =>
    t
      .desc('Delete a value from the shared state board by key.')
      .string('key', 'The key to delete')
      .string('namespace', 'Optional namespace (default: "default")')
      .required('key'),
  ),
  tool('state_board_list', (t) =>
    t
      .desc('List all keys in the shared state board, optionally filtered by namespace.')
      .string('namespace', 'Optional namespace filter (default: all namespaces)')
      .boolean('includeValues', 'Include current values in the response (default: false)')
      .query(),
  ),
  tool('state_board_watch', (t) =>
    t
      .desc('Start or stop watching a key or pattern for changes.')
      .enum('action', ['start', 'stop'], 'Watch operation: start or stop')
      .string('key', 'The key or pattern to watch (action=start)')
      .string('namespace', 'Optional namespace (default: "default")')
      .number('pollIntervalMs', 'Polling interval in ms (action=start, default: 1000)')
      .string('watchId', 'Watch ID to stop (action=stop)')
      .required('action'),
  ),
  tool('state_board_history', (t) =>
    t
      .desc('Get the change history for a key.')
      .string('key', 'The key to get history for')
      .string('namespace', 'Optional namespace (default: "default")')
      .number('limit', 'Maximum number of history entries to return (default: 50)')
      .query()
      .required('key'),
  ),
  tool('state_board_io', (t) =>
    t
      .desc('Export or import state board entries.')
      .enum('action', ['export', 'import'], 'IO operation')
      .string(
        'namespace',
        'Optional namespace filter for export / target namespace for import (default: all/"default")',
      )
      .string('keyPattern', 'Optional key pattern filter for export (supports * wildcard)')
      .prop('data', {
        type: 'object',
        description: 'Object with keys and values to import (action=import)',
      })
      .boolean('overwrite', 'Overwrite existing keys on import (default: false)')
      .required('action'),
  ),
  tool('state_board_clear', (t) =>
    t
      .desc('Clear all or filtered state board entries.')
      .string('namespace', 'Optional namespace to clear (default: all)')
      .string('keyPattern', 'Optional key pattern to clear (supports * wildcard)'),
  ),
];
