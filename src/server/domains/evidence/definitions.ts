import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

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
      .desc('Get full provenance chain from a node ID in specified direction')
      .string('nodeId', 'Evidence node ID to start from')
      .enum('direction', ['forward', 'backward'], 'Traversal direction', { default: 'forward' })
      .required('nodeId')
      .query(),
  ),
];
