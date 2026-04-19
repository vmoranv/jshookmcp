import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const queryTypes = [
  'before-load-inject',
  'runtime-hook',
  'network-intercept',
  'function-trace',
] as const;

export const instrumentationTools: Tool[] = [
  tool('instrumentation_session', (t) =>
    t
      .desc(
        `Manage instrumentation sessions that group hooks, intercepts, and traces.

Actions:
- create: Create a new session
- list: List all active sessions
- destroy: Destroy a session (requires sessionId)
- status: Get detailed session status (requires sessionId)`,
      )
      .enum('action', ['create', 'list', 'destroy', 'status'], 'Session operation')
      .string('sessionId', 'Session ID (required for destroy/status)')
      .required('action'),
  ),
  tool('instrumentation_operation', (t) =>
    t
      .desc(
        `Manage operations within an instrumentation session.

Actions:
- register: Register a new operation (requires sessionId, type, target)
- list: List operations in a session (requires sessionId)`,
      )
      .enum('action', ['register', 'list'], 'Operation')
      .enum('type', queryTypes, 'Instrumentation type (action=register)')
      .string('target', 'Function name, URL pattern, or script target (action=register)')
      .object('config', {}, 'Operation-specific config (action=register)')
      .required('action', 'sessionId'),
  ),
  tool('instrumentation_artifact', (t) =>
    t
      .desc(
        `Manage captured artifacts for instrumentation operations.

Actions:
- record: Record a captured artifact (requires operationId, data)
- query: Query captured artifacts (requires sessionId)`,
      )
      .enum('action', ['record', 'query'], 'Artifact operation')
      .string('operationId', 'Operation ID (action=record)')
      .object('data', {}, 'Captured artifact payload (action=record)')
      .enum('type', queryTypes, 'Optional artifact type filter (action=query)')
      .number('limit', 'Max artifacts to return (action=query, default: 50)', { default: 50 })
      .required('action', 'sessionId'),
  ),
  tool('instrumentation_hook_preset', (t) =>
    t
      .desc('Apply hooks domain preset hooks within an instrumentation session and persist...')
      .string('preset', 'Single preset id to inject')
      .array('presets', { type: 'string' }, 'Multiple preset ids to inject in one call')
      .boolean('captureStack', 'Whether injected presets should capture stack traces', {
        default: false,
      })
      .boolean('logToConsole', 'Whether injected presets should log to console', { default: true })
      .enum(
        'method',
        ['evaluate', 'evaluateOnNewDocument'],
        'Injection method forwarded to hook_preset',
        { default: 'evaluate' },
      )
      .prop('customTemplate', {
        type: 'object',
        additionalProperties: true,
        description: 'Optional inline custom preset definition',
      })
      .prop('customTemplates', {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: 'Optional inline custom preset definitions',
      })
      .requiredOpenWorld('sessionId'),
  ),
  tool('instrumentation_network_replay', (t) =>
    t
      .desc('Replay a previously captured network request inside an instrumentation sessio...')
      .string('requestId', 'Captured request ID returned by network_get_requests')
      .object(
        'headerPatch',
        { additionalProperties: { type: 'string' } },
        'Optional request header overrides',
      )
      .string('bodyPatch', 'Optional raw request body override')
      .string('methodOverride', 'Optional HTTP method override')
      .string('urlOverride', 'Optional destination URL override')
      .number('timeoutMs', 'Optional replay timeout in milliseconds')
      .boolean('dryRun', 'Preview the replay without sending the request', { default: true })
      .requiredOpenWorld('sessionId', 'requestId'),
  ),
];
