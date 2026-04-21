import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const sharedStateBoardTools: Tool[] = [
  tool('state_board', (t) =>
    t
      .desc(
        `Unified shared state board for cross-agent key-value coordination.

Actions:
- set: Store a value (requires key, value)
- get: Retrieve a value (requires key)
- delete: Remove a value (requires key)
- list: List all entries (optional namespace filter)
- history: Get change log for a key (requires key)
- clear: Remove entries (optional namespace/keyPattern filter)`,
      )
      .enum('action', ['set', 'get', 'delete', 'list', 'history', 'clear'], 'Operation to perform')
      .string('key', 'Key name (required for set/get/delete/history)')
      .prop('value', {
        type: 'object',
        description: 'Value to store — any JSON-serializable type (action=set)',
      })
      .string('namespace', 'Namespace for key isolation (default: "default")')
      .number('ttlSeconds', 'TTL in seconds — value expires after this duration (action=set)')
      .boolean('includeValues', 'Include current values in list response (action=list)', {
        default: false,
      })
      .number('limit', 'Maximum history entries to return (action=history)', { default: 50 })
      .string('keyPattern', 'Key pattern filter with * wildcard (action=clear)')
      .required('action'),
  ),
  tool('state_board_watch', (t) =>
    t
      .desc(
        'Watch a key or pattern for changes. ' +
          'This is a POLL-based watch — call state_board_watch with action=poll and the returned watchId to check for changes. ' +
          'No server-side push; the caller must poll periodically.',
      )
      .enum(
        'action',
        ['start', 'poll', 'stop'],
        'Watch operation: start watching, poll for changes, or stop watching',
      )
      .string('key', 'The key or pattern to watch (action=start)')
      .string('namespace', 'Optional namespace (default: "default")')
      .number('pollIntervalMs', 'Polling interval in ms (action=start, default: 1000)')
      .string('watchId', 'Watch ID to stop (action=stop)')
      .required('action'),
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
];
