import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const sharedStateBoardTools: Tool[] = [
  tool('state_board_set', (t) =>
    t
      .desc(
        'Set a value in the shared state board. Supports string, number, boolean, object, and array values.',
      )
      .string('key', 'The key to store the value under')
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
      .desc(
        'Watch a key or pattern for changes. Returns a watch ID that can be used to poll for updates.',
      )
      .string('key', 'The key to watch (supports * wildcard for pattern matching)')
      .string('namespace', 'Optional namespace (default: "default")')
      .number('pollIntervalMs', 'Polling interval in milliseconds (default: 1000)')
      .required('key'),
  ),
  tool('state_board_unwatch', (t) =>
    t
      .desc('Stop watching a key or pattern.')
      .string('watchId', 'The watch ID returned by state_board_watch')
      .required('watchId'),
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
  tool('state_board_export', (t) =>
    t
      .desc('Export all or filtered state board entries as JSON.')
      .string('namespace', 'Optional namespace filter (default: all)')
      .string('keyPattern', 'Optional key pattern filter (supports * wildcard)')
      .query(),
  ),
  tool('state_board_import', (t) =>
    t
      .desc('Import state board entries from JSON. Merges with existing state.')
      .prop('data', {
        type: 'object',
        description: 'Object with keys and values to import',
      })
      .string('namespace', 'Optional namespace (default: "default")')
      .boolean('overwrite', 'Overwrite existing keys (default: false)')
      .required('data'),
  ),
  tool('state_board_clear', (t) =>
    t
      .desc('Clear all or filtered state board entries.')
      .string('namespace', 'Optional namespace to clear (default: all)')
      .string('keyPattern', 'Optional key pattern to clear (supports * wildcard)'),
  ),
];
