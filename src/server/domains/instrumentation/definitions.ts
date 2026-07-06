import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { networkAuthorizationSchema } from '@server/domains/network/authorization-schema';
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
      .desc('Start, stop, or query status of an instrumentation recording session.')
      .enum('action', ['create', 'list', 'destroy', 'status'], 'Session operation')
      .string('name', 'Optional session name for create')
      .string('sessionId', 'Session ID (required for destroy/status)')
      .required('action'),
  ),
  tool('instrumentation_session_export', (t) =>
    t
      .desc('Export an instrumentation session snapshot to an artifacts JSON file.')
      .string('sessionId', 'Session ID to export')
      .string('outputDir', 'Optional project-relative output directory under the workspace')
      .required('sessionId'),
  ),
  tool('instrumentation_operation', (t) =>
    t
      .desc('Manage operations inside an instrumentation session.')
      .enum('action', ['register', 'list', 'status', 'stop'], 'Operation')
      .string('sessionId', 'Session ID')
      .string('operationId', 'Operation ID for status or stop')
      .enum('type', queryTypes, 'Instrumentation type (action=register)')
      .string('target', 'Function name, URL pattern, or script target (action=register)')
      .object('config', {}, 'Operation-specific config (action=register)')
      .required('action', 'sessionId'),
  ),
  tool('instrumentation_artifact', (t) =>
    t
      .desc('Manage artifacts captured by instrumentation operations.')
      .enum('action', ['record', 'query'], 'Artifact operation')
      .string('sessionId', 'Session ID')
      .string('operationId', 'Operation ID (action=record)')
      .object('data', {}, 'Captured artifact payload (action=record)')
      .enum('type', queryTypes, 'Optional artifact type filter (action=query)')
      .number('limit', 'Max artifacts to return (action=query, default: 50)', {
        default: 50,
        minimum: 1,
        maximum: 500,
      })
      .required('action', 'sessionId'),
  ),
  tool('instrumentation_hook_preset', (t) =>
    t
      .desc('Apply hook presets inside an instrumentation session.')
      .string('sessionId', 'Session ID')
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
      .desc('Replay a captured network request inside an instrumentation session.')
      .string('sessionId', 'Session ID')
      .string('requestId', 'Captured request ID returned by network_get_requests')
      .object(
        'headerPatch',
        { additionalProperties: { type: 'string' } },
        'Optional request header overrides',
      )
      .string('bodyPatch', 'Optional raw request body override')
      .string('methodOverride', 'Optional HTTP method override')
      .string('urlOverride', 'Optional destination URL override')
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Optional request-scoped authorization for private-network or insecure-HTTP replay.',
      )
      .string(
        'authorizationCapability',
        'Optional base64url-encoded request-scoped authorization capability.',
      )
      .number('timeoutMs', 'Optional replay timeout in milliseconds')
      .boolean('dryRun', 'Preview the replay without sending the request', { default: true })
      .requiredOpenWorld('sessionId', 'requestId'),
  ),
];

export const aiHookTools: Tool[] = [
  tool('ai_hook', (t) =>
    t
      .desc(
        'Manage AI hooks. Actions: inject (inject code into page), get_data (retrieve captured hook data), list ' +
          '(all active hooks), clear (remove hook data by id or all), toggle (enable/disable a hook), export ' +
          '(export data as JSON/CSV).',
      )
      .enum(
        'action',
        ['inject', 'get_data', 'list', 'clear', 'toggle', 'export'],
        'Operation to perform',
      )
      .string(
        'hookId',
        'Hook identifier (required for inject/get_data/toggle; optional for clear/export)',
      )
      .string('code', 'Hook code to inject (required for action=inject)')
      .enum(
        'method',
        ['evaluateOnNewDocument', 'evaluate'],
        'Injection method (for action=inject)',
        {
          default: 'evaluate',
        },
      )
      .boolean('enabled', 'Enable or disable hook (required for action=toggle)')
      .enum('format', ['json', 'csv'], 'Export format (for action=export)', { default: 'json' })
      .required('action'),
  ),
];

export const hookPresetTools: Tool[] = [
  tool('hook_preset', (t) =>
    t
      .desc(
        'Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, ' +
          'Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable ' +
          'hook bodies. Use listPresets=true to see all available preset descriptions.',
      )
      .string(
        'preset',
        'Single preset name to install. Accepts built-in preset ids or ids provided by customTemplate/customTemplates.',
      )
      .array(
        'presets',
        { type: 'string' },
        'List of preset names to install simultaneously. Accepts built-in ids and custom template ids.',
      )
      .prop('customTemplate', {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable preset id, for example deobfuscation-sinks' },
          description: {
            type: 'string',
            description: 'Human-readable description for listPresets output.',
          },
          body: {
            type: 'string',
            description: 'Hook body snippet inserted into the preset wrapper.',
          },
        },
        required: ['id', 'body'],
        description:
          'Inline custom template. body should contain the hook body inserted into the standard buildHookCode ' +
          'wrapper. Use {{STACK_CODE}} and {{LOG_FN}} placeholders when needed.',
      })
      .prop('customTemplates', {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['id', 'body'],
        },
        description: 'List of inline custom templates to register for this invocation.',
      })
      .boolean('captureStack', 'Include call stack in captured data (has performance impact)', {
        default: false,
      })
      .boolean('logToConsole', 'Log hook events to browser console', { default: true })
      .enum(
        'method',
        ['evaluate', 'evaluateOnNewDocument'],
        'Injection method: evaluate=current page, evaluateOnNewDocument=before page scripts',
        { default: 'evaluate' },
      )
      .boolean(
        'listPresets',
        'Set to true to list all available presets with descriptions instead of installing.',
        { default: false },
      ),
  ),
];

export const evidenceTools: Tool[] = [
  tool('evidence_query', (t) =>
    t
      .desc(
        'Query reverse evidence graph by URL, function name, or script ID to find associated nodes.',
      )
      .enum('by', ['url', 'function', 'script'], 'Query dimension')
      .string('value', 'Search value: URL/fragment, function name, or script ID')
      .required('by', 'value')
      .query(),
  ),
  tool('evidence_export', (t) =>
    t
      .desc('Export the reverse evidence graph as JSON snapshot or Markdown report.')
      .enum('format', ['json', 'markdown'], 'Export format')
      .required('format')
      .query(),
  ),
  tool('evidence_chain', (t) =>
    t
      .desc('Get full provenance chain from a node ID in specified direction.')
      .string('nodeId', 'Evidence node ID to start from')
      .enum('direction', ['forward', 'backward'], 'Traversal direction', { default: 'forward' })
      .required('nodeId')
      .query(),
  ),
];
