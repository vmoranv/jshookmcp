import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const graphqlTools: Tool[] = [
  tool('call_graph_analyze', (t) =>
    t
      .desc('Analyze runtime function call graph from in-page traces.')
      .number('maxDepth', 'Maximum stack-derived edge depth', { default: 5 })
      .string('filterPattern', 'Regex filter for function names')
      .query(),
  ),
  tool('script_replace_persist', (t) =>
    t
      .desc('Persistently replace matching script responses.')
      .string('url', 'Script URL match pattern')
      .string('replacement', 'Replacement JavaScript source')
      .enum('matchType', ['exact', 'contains', 'regex'], 'URL matching strategy', {
        default: 'contains',
      })
      .requiredOpenWorld('url', 'replacement'),
  ),
  tool('graphql_introspect', (t) =>
    t
      .desc('Run GraphQL introspection and optional Apollo Federation _service.sdl probing.')
      .string('endpoint', 'GraphQL endpoint URL')
      .prop('headers', {
        type: 'object',
        description: 'Custom request headers',
        additionalProperties: { type: 'string' },
      })
      .boolean(
        'useBrowser',
        'Use the active browser session for fetch so cookies and CSRF/app-injected headers are preserved. Set ' +
          'false to force a Node-side fetch.',
        { default: true },
      )
      .boolean('includeFederation', 'Also probe Apollo Federation _service { sdl } metadata.', {
        default: true,
      })
      .requiredOpenWorld('endpoint'),
  ),
  tool('graphql_extract_queries', (t) =>
    t
      .desc('Extract GraphQL queries/mutations from captured network traces.')
      .number('limit', 'Maximum extracted operations', { default: 50 })
      .query(),
  ),
  tool('graphql_replay', (t) =>
    t
      .desc(
        'Replay a GraphQL operation with optional variables, batch array, or Apollo persisted-query (APQ) extensions.',
      )
      .string('endpoint', 'GraphQL endpoint URL')
      .string('query', 'GraphQL query/mutation string (required unless batch is provided)')
      .prop('variables', {
        type: 'object',
        description: 'GraphQL variables',
        additionalProperties: true,
      })
      .string('operationName', 'GraphQL operationName')
      .prop('headers', {
        type: 'object',
        description: 'Custom request headers',
        additionalProperties: { type: 'string' },
      })
      .boolean(
        'useBrowser',
        'Use the active browser session for fetch so cookies and CSRF/app-injected headers are preserved. Set ' +
          'false to force a Node-side fetch.',
        { default: true },
      )
      .prop('persistedQuery', {
        type: 'object',
        description:
          'Apollo persisted-query (APQ) extension block. Adds extensions.persistedQuery { sha256Hash, version } to the body so traffic using APQ / Relay_preload replays faithfully.',
        properties: {
          sha256Hash: { type: 'string', description: 'The APQ query hash (sha256)' },
          version: { type: 'integer', description: 'APQ version (defaults to 1)' },
        },
        required: ['sha256Hash'],
        additionalProperties: false,
      })
      .prop('batch', {
        type: 'array',
        description:
          'Batch replay: array of operations. When set, the request body is a JSON array and the server response is an array. Each item is { query, variables?, operationName? }.',
        items: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            variables: { type: 'object', additionalProperties: true },
            operationName: { type: 'string' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      })
      .requiredOpenWorld('endpoint'),
  ),
  tool('graphql_enum_schema', (t) =>
    t
      .desc('Enumerate GraphQL fields from server suggestion errors with introspection fallback.')
      .string('endpoint', 'GraphQL endpoint URL')
      .string('typeName', 'Root type name to report', { default: 'Query' })
      .string('parentType', 'Type name to probe fields on')
      .number('maxDepth', 'Maximum enumeration depth', { default: 1, minimum: 1, maximum: 6 })
      .number('concurrency', 'Reserved concurrency hint for future expansion', {
        default: 3,
        minimum: 1,
        maximum: 10,
      })
      .prop('headers', {
        type: 'object',
        description: 'Custom request headers',
        additionalProperties: { type: 'string' },
      })
      .requiredOpenWorld('endpoint'),
  ),
  tool('graphql_subscribe', (t) =>
    t
      .desc(
        'Open a GraphQL subscription WebSocket, perform the graphql-transport-ws (or legacy graphql-ws) handshake, send a subscribe frame, and collect frames for collectMs. Runs in-page so the browser-session auth (cookies + connectionPayload) is preserved. Pairs with graphql_replay for targets that expose queries/mutations only via the authed WebSocket session.',
      )
      .string(
        'endpoint',
        'GraphQL subscription WebSocket endpoint. ws:/wss: used directly; http:/https: auto-upgraded to ws/wss.',
      )
      .string('query', 'GraphQL subscription query string')
      .prop('variables', {
        type: 'object',
        description: 'GraphQL variables for the subscription',
        additionalProperties: true,
      })
      .string('operationName', 'GraphQL operationName')
      .prop('connectionPayload', {
        type: 'object',
        description:
          'Payload sent in the connection_init frame (e.g. { Authorization: "Bearer ..." }). Auth context that makes the subscription work.',
        additionalProperties: true,
      })
      .enum(
        'protocol',
        ['graphql-transport-ws', 'graphql-ws'],
        'WebSocket subprotocol. graphql-transport-ws is the modern standard; graphql-ws is the legacy subscriptions-transport-ws dialect.',
        { default: 'graphql-transport-ws' },
      )
      .number('collectMs', 'How long to collect frames after subscribe before sending complete.', {
        default: 3000,
        minimum: 100,
      })
      .number('connectTimeoutMs', 'Timeout waiting for connection_ack before giving up.', {
        default: 5000,
        minimum: 500,
      })
      .requiredOpenWorld('endpoint', 'query'),
  ),
];
