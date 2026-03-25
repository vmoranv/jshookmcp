import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const instrumentationTools: Tool[] = [
  {
    name: 'instrumentation_session_create',
    description:
      'Create a new instrumentation session that groups hooks, intercepts, and traces into a single queryable container.\n\nAll subsequent instrumentation operations can be associated with this session for unified management and artifact export.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional human-readable name for the session',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'instrumentation_session_list',
    description:
      'List all active instrumentation sessions with their operation and artifact counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'instrumentation_session_destroy',
    description:
      'Destroy an instrumentation session, marking all its operations as completed. Session data is retained for querying but no new operations can be added.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned by instrumentation_session_create',
        },
      },
      required: ['sessionId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'instrumentation_session_status',
    description:
      'Get detailed status for an instrumentation session including operation count, artifact count, and active/destroyed state.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID',
        },
      },
      required: ['sessionId'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'instrumentation_operation_register',
    description:
      'Register a new instrumentation operation within a session so hooks, intercepts, and traces become queryable evidence-producing work items.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned by instrumentation_session_create',
        },
        type: {
          type: 'string',
          enum: ['before-load-inject', 'runtime-hook', 'network-intercept', 'function-trace'],
          description: 'Instrumentation type to register',
        },
        target: {
          type: 'string',
          description: 'Function name, URL pattern, or script target for the operation',
        },
        config: {
          type: 'object',
          description: 'Operation-specific configuration payload',
          default: {},
        },
      },
      required: ['sessionId', 'type', 'target'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'instrumentation_operation_list',
    description:
      'List all operations (hooks, intercepts, traces) registered within a session, optionally filtered by type.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID',
        },
        type: {
          type: 'string',
          enum: ['before-load-inject', 'runtime-hook', 'network-intercept', 'function-trace'],
          description: 'Optional filter by instrumentation type',
        },
      },
      required: ['sessionId'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'instrumentation_artifact_record',
    description:
      'Record a captured artifact for an instrumentation operation so the session and evidence graph reflect observed runtime data.',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: {
          type: 'string',
          description: 'Operation ID returned by instrumentation_operation_register',
        },
        data: {
          type: 'object',
          description: 'Captured artifact payload such as args, returnValue, headers, or body',
        },
      },
      required: ['operationId', 'data'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'instrumentation_artifact_query',
    description:
      'Query captured artifacts (args, return values, intercepted requests, trace data) from a session, optionally filtered by type and limited.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID',
        },
        type: {
          type: 'string',
          enum: ['before-load-inject', 'runtime-hook', 'network-intercept', 'function-trace'],
          description: 'Optional filter by artifact type',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of artifacts to return (default: 50)',
          default: 50,
        },
      },
      required: ['sessionId'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'instrumentation_hook_preset',
    description:
      'Apply hooks domain preset hooks within an instrumentation session and persist the injected preset summary as session artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned by instrumentation_session_create',
        },
        preset: {
          type: 'string',
          description: 'Single preset id to inject',
        },
        presets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple preset ids to inject in one call',
        },
        captureStack: {
          type: 'boolean',
          description: 'Whether injected presets should capture stack traces',
          default: false,
        },
        logToConsole: {
          type: 'boolean',
          description: 'Whether injected presets should log to console',
          default: true,
        },
        method: {
          type: 'string',
          enum: ['evaluate', 'evaluateOnNewDocument'],
          description: 'Injection method forwarded to hook_preset',
          default: 'evaluate',
        },
        customTemplate: {
          type: 'object',
          description: 'Optional inline custom preset definition',
          additionalProperties: true,
        },
        customTemplates: {
          type: 'array',
          description: 'Optional inline custom preset definitions',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      required: ['sessionId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'instrumentation_network_replay',
    description:
      'Replay a previously captured network request inside an instrumentation session and persist the replay result or dry-run preview as session artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned by instrumentation_session_create',
        },
        requestId: {
          type: 'string',
          description: 'Captured request ID returned by network_get_requests',
        },
        headerPatch: {
          type: 'object',
          description: 'Optional request header overrides',
          additionalProperties: { type: 'string' },
        },
        bodyPatch: {
          type: 'string',
          description: 'Optional raw request body override',
        },
        methodOverride: {
          type: 'string',
          description: 'Optional HTTP method override',
        },
        urlOverride: {
          type: 'string',
          description: 'Optional destination URL override',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional replay timeout in milliseconds',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview the replay without sending the request',
          default: true,
        },
      },
      required: ['sessionId', 'requestId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];
