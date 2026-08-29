import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const mojoIpcTools: Tool[] = [
  tool('mojo_ipc_capabilities', (t) => t.desc('Report Mojo IPC monitoring availability.').query()),
  tool('mojo_monitor', (t) =>
    t
      .desc('Start or stop Mojo IPC monitoring for the active Chromium-based target.')
      .enum('action', ['start', 'stop'], 'Monitor action')
      .string('deviceId', 'Optional device or transport identifier (action=start)')
      .required('action'),
  ),
  tool('mojo_decode_message', (t) =>
    t
      .desc('Decode a Mojo IPC hex payload into a structured field map.')
      .string('hexPayload', 'Hex-encoded Mojo IPC payload')
      .string('interfaceName', 'Optional Mojo interface name used to label known fields')
      .prop('messageType', {
        anyOf: [{ type: 'string' }, { type: 'number' }],
        description: 'Optional method name or message type used with interfaceName to label fields',
      })
      .required('hexPayload')
      .query(),
  ),
  tool('mojo_encode_message', (t) =>
    t
      .desc('Encode a structured Mojo IPC message into a hex payload.')
      .string('interfaceName', 'Mojo interface name, for example network.mojom.URLLoaderFactory')
      .prop('messageType', {
        anyOf: [{ type: 'string' }, { type: 'number' }],
        description: 'Message type as a method name, decimal number, or 0x-prefixed hex value',
      })
      .array(
        'fields',
        {
          anyOf: [
            { type: 'boolean' },
            { type: 'number' },
            { type: 'string' },
            { type: 'object', additionalProperties: true },
          ],
        },
        'Fields to encode. Objects may specify { type, value }, arrays, structs, or handles.',
      )
      .prop('header', {
        type: 'object',
        additionalProperties: false,
        properties: {
          expectsResponse: { type: 'boolean' },
          isResponse: { type: 'boolean' },
          isSync: { type: 'boolean' },
          interfaceId: { type: 'number' },
          requestId: {
            anyOf: [{ type: 'integer' }, { type: 'string' }],
            description: 'Request id as a number or numeric string (encoded as uint64)',
          },
        },
        description:
          'Optional v2 header fields. Setting any flag or interfaceId/requestId emits an 18-byte v2 ' +
          'message header; omit to emit the default 6-byte v1 header.',
      })
      .required('interfaceName', 'messageType', 'fields')
      .query(),
  ),
  tool('mojo_list_interfaces', (t) =>
    t.desc('List discovered Mojo IPC interfaces and their pending message counts.').query(),
  ),
  tool('mojo_messages_get', (t) =>
    t
      .desc('Retrieve captured Mojo IPC messages from the active monitoring session.')
      .number('limit', 'Maximum number of messages to retrieve (default 100)')
      .string('interface', 'Filter messages by interface name')
      .prop('messageType', {
        anyOf: [{ type: 'string' }, { type: 'number' }],
        description: 'Filter messages by message type or method name',
      })
      .number('sinceTimestamp', 'Only return messages captured at or after this Unix timestamp')
      .string('hexSearch', 'Case-insensitive hex substring to search in captured payloads')
      .enum(
        'direction',
        ['request', 'response', 'sync'],
        'Filter by message direction inferred from the header flags byte',
      )
      .query(),
  ),
  tool('mojo_verify_live', (t) =>
    t
      .desc(
        'Generate a Frida verification script that probes a target Chromium process ' +
          'for known Mojo C-API exports (MojoWriteMessage, MojoWriteMessageNew) across ' +
          'modules. Uses a curated symbol database covering Chromium M96+ across Win32, ' +
          'Linux, and macOS. Returns a ready-to-run Frida script and probe metadata. ' +
          'Honest boundary (B-class): symbol DB is manually curated; symbols may vary by ' +
          'build config. Verified flag is always false — confirm against the live binary.',
      )
      .enum('platform', ['win32', 'linux', 'darwin'], 'Target platform')
      .number('chromiumVersion', 'Chromium major version (e.g. 120) for version-aware probing')
      .enum('channel', ['stable', 'beta', 'dev', 'canary'], 'Chromium release channel', {
        default: 'stable',
      })
      .string('targetProcess', 'Browser process name for the frida command (default: chrome)')
      .required('platform')
      .readOnly(),
  ),
  tool('mojo_messages_summarize', (t) =>
    t
      .desc(
        'Aggregate the captured Mojo IPC buffer (non-destructive) into interface/method/' +
          'direction breakdowns, top-N lists, and a capture time window. Does not drain the buffer.',
      )
      .string('interface', 'Restrict the summary to a single interface name')
      .prop('messageType', {
        anyOf: [{ type: 'string' }, { type: 'number' }],
        description: 'Restrict the summary to a single message type or method name',
      })
      .number('sinceTimestamp', 'Only include messages captured at or after this Unix timestamp')
      .string('hexSearch', 'Case-insensitive hex substring that must appear in included payloads')
      .enum(
        'direction',
        ['request', 'response', 'sync'],
        'Restrict the summary to a single message direction',
      )
      .number('topN', 'Number of top interfaces/methods to return (default 5)')
      .query(),
  ),
];
