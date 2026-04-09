import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const graphqlTools: Tool[] = [
  tool('call_graph_analyze', (t) =>
    t
      .desc('Analyze runtime function call graph from in-page traces')
      .number('maxDepth', 'Maximum stack-derived edge depth', { default: 5 })
      .string('filterPattern', 'Regex filter for function names')
      .query(),
  ),
  tool('script_replace_persist', (t) =>
    t
      .desc('Persistently replace matching script responses via request interception')
      .string('url', 'Script URL match pattern')
      .string('replacement', 'Replacement JavaScript source')
      .enum('matchType', ['exact', 'contains', 'regex'], 'URL matching strategy', {
        default: 'contains',
      })
      .requiredOpenWorld('url', 'replacement'),
  ),
  tool('graphql_introspect', (t) =>
    t
      .desc('Run GraphQL introspection query against a target endpoint')
      .string('endpoint', 'GraphQL endpoint URL')
      .prop('headers', {
        type: 'object',
        description: 'Custom request headers',
        additionalProperties: { type: 'string' },
      })
      .requiredOpenWorld('endpoint'),
  ),
  tool('graphql_extract_queries', (t) =>
    t
      .desc('Extract GraphQL queries/mutations from captured network traces')
      .number('limit', 'Maximum extracted operations', { default: 50 })
      .query(),
  ),
  tool('graphql_replay', (t) =>
    t
      .desc('Replay a GraphQL operation with optional variables via in-page fetch')
      .string('endpoint', 'GraphQL endpoint URL')
      .string('query', 'GraphQL query/mutation string')
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
      .requiredOpenWorld('endpoint', 'query'),
  ),
];
