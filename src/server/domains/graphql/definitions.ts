import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const graphqlTools: Tool[] = [
  {
    name: 'call_graph_analyze',
    description:
      'Analyze runtime function call graph from in-page traces (__aiHooks / tracer records). Returns nodes, edges, and stats.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          description: 'Maximum stack-derived edge depth to include (default: 5, min: 1, max: 20).',
          default: 5,
        },
        filterPattern: {
          type: 'string',
          description: 'Optional regex string to filter function names (source or target).',
        },
      },
    },
  },
  {
    name: 'script_replace_persist',
    description:
      'Persistently replace matching script responses via request interception, and register metadata with evaluateOnNewDocument.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Script URL match pattern.',
        },
        replacement: {
          type: 'string',
          description: 'Replacement JavaScript source (full script content).',
        },
        matchType: {
          type: 'string',
          enum: ['exact', 'contains', 'regex'],
          description: "URL matching strategy. Defaults to 'contains'.",
          default: 'contains',
        },
      },
      required: ['url', 'replacement'],
    },
  },
  {
    name: 'graphql_introspect',
    description: 'Run GraphQL introspection query against a target endpoint and return schema payload.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: {
          type: 'string',
          description: 'GraphQL endpoint URL.',
        },
        headers: {
          type: 'object',
          description: 'Optional custom request headers.',
          additionalProperties: {
            type: 'string',
          },
        },
      },
      required: ['endpoint'],
    },
  },
  {
    name: 'graphql_extract_queries',
    description:
      'Extract GraphQL queries/mutations from captured in-page network traces (fetch/xhr/aiHook records).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of extracted operations to return (default: 50, max: 200).',
          default: 50,
        },
      },
    },
  },
  {
    name: 'graphql_replay',
    description: 'Replay a GraphQL operation with optional variables and headers via in-page fetch.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: {
          type: 'string',
          description: 'GraphQL endpoint URL.',
        },
        query: {
          type: 'string',
          description: 'GraphQL query/mutation string.',
        },
        variables: {
          type: 'object',
          description: 'GraphQL variables object.',
          additionalProperties: true,
        },
        operationName: {
          type: 'string',
          description: 'Optional GraphQL operationName.',
        },
        headers: {
          type: 'object',
          description: 'Optional custom request headers.',
          additionalProperties: {
            type: 'string',
          },
        },
      },
      required: ['endpoint', 'query'],
    },
  },
];
