import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const queryTypes = [
  'before-load-inject',
  'runtime-hook',
  'network-intercept',
  'function-trace',
] as const;

export const instrumentationTools: Tool[] = [
  tool('instrumentation_session_create', (t) =>
    t
      .desc(
        'Create a new instrumentation session that groups hooks, intercepts, and traces into a single queryable container.\n\nAll subsequent instrumentation operations can be associated with this session for unified management and artifact export.',
      )
      .string('name', 'Optional human-readable name for the session'),
  ),
  tool('instrumentation_session_list', (t) =>
    t
      .desc('List all active instrumentation sessions with their operation and artifact counts.')
      .query(),
  ),
  tool('instrumentation_session_destroy', (t) =>
    t
      .desc(
        'Destroy an instrumentation session, marking all its operations as completed. Session data is retained for querying but no new operations can be added.',
      )
      .string('sessionId', 'Session ID returned by instrumentation_session_create')
      .required('sessionId')
      .resettable(),
  ),
  tool('instrumentation_session_status', (t) =>
    t
      .desc(
        'Get detailed status for an instrumentation session including operation count, artifact count, and active/destroyed state.',
      )
      .string('sessionId', 'Session ID')
      .required('sessionId')
      .query(),
  ),
  tool('instrumentation_operation_register', (t) =>
    t
      .desc(
        'Register a new instrumentation operation within a session so hooks, intercepts, and traces become queryable evidence-producing work items.',
      )
      .string('sessionId', 'Session ID returned by instrumentation_session_create')
      .enum('type', queryTypes, 'Instrumentation type to register')
      .string('target', 'Function name, URL pattern, or script target for the operation')
      .object('config', {}, 'Operation-specific configuration payload')
      .required('sessionId', 'type', 'target'),
  ),
  tool('instrumentation_operation_list', (t) =>
    t
      .desc(
        'List all operations (hooks, intercepts, traces) registered within a session, optionally filtered by type.',
      )
      .string('sessionId', 'Session ID')
      .enum('type', queryTypes, 'Optional filter by instrumentation type')
      .required('sessionId')
      .query(),
  ),
  tool('instrumentation_artifact_record', (t) =>
    t
      .desc(
        'Record a captured artifact for an instrumentation operation so the session and evidence graph reflect observed runtime data.',
      )
      .string('operationId', 'Operation ID returned by instrumentation_operation_register')
      .object('data', {}, 'Captured artifact payload such as args, returnValue, headers, or body')
      .required('operationId', 'data'),
  ),
  tool('instrumentation_artifact_query', (t) =>
    t
      .desc(
        'Query captured artifacts (args, return values, intercepted requests, trace data) from a session, optionally filtered by type and limited.',
      )
      .string('sessionId', 'Session ID')
      .enum('type', queryTypes, 'Optional filter by artifact type')
      .number('limit', 'Maximum number of artifacts to return', { default: 50 })
      .required('sessionId')
      .query(),
  ),
  tool('instrumentation_hook_preset', (t) =>
    t
      .desc(
        'Apply hooks domain preset hooks within an instrumentation session and persist the injected preset summary as session artifacts.',
      )
      .string('sessionId', 'Session ID returned by instrumentation_session_create')
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
      .desc(
        'Replay a previously captured network request inside an instrumentation session and persist the replay result or dry-run preview as session artifacts.',
      )
      .string('sessionId', 'Session ID returned by instrumentation_session_create')
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
