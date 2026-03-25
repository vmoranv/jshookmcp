import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const evidenceTools: Tool[] = [
  {
    name: 'evidence_query_url',
    description:
      'Query the reverse evidence graph for all nodes associated with a URL. Returns the connected subgraph including request, initiator-stack, script, function, and captured-data nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL or URL fragment to search for',
        },
      },
      required: ['url'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'evidence_query_function',
    description:
      'Query the reverse evidence graph for all nodes associated with a function name. Returns the connected subgraph including function, breakpoint-hook, and captured-data nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Function name or name fragment to search for',
        },
      },
      required: ['name'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'evidence_query_script',
    description:
      'Query the reverse evidence graph for all nodes associated with a script ID. Returns the connected subgraph including script, function, and downstream nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: 'Script ID to search for',
        },
      },
      required: ['scriptId'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'evidence_export_json',
    description:
      'Export the entire reverse evidence graph as a JSON snapshot. Includes all nodes, edges, and metadata.',
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
    name: 'evidence_export_markdown',
    description:
      'Export the reverse evidence graph as a human-readable Markdown report, grouped by node type with edge connections.',
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
    name: 'evidence_chain',
    description:
      'Get the full provenance chain from a specific node ID, traversing edges in the specified direction (forward or backward).',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Evidence node ID to start traversal from',
        },
        direction: {
          type: 'string',
          enum: ['forward', 'backward'],
          description: 'Traversal direction (default: forward)',
          default: 'forward',
        },
      },
      required: ['nodeId'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
