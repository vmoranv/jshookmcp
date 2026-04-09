import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const evidenceTools: Tool[] = [
  tool('evidence_query_url', (t) =>
    t
      .desc('Query reverse evidence graph for all nodes associated with a URL')
      .string('url', 'URL or URL fragment to search')
      .required('url')
      .query(),
  ),
  tool('evidence_query_function', (t) =>
    t
      .desc('Query reverse evidence graph for all nodes associated with a function name')
      .string('name', 'Function name or fragment to search')
      .required('name')
      .query(),
  ),
  tool('evidence_query_script', (t) =>
    t
      .desc('Query reverse evidence graph for all nodes associated with a script ID')
      .string('scriptId', 'Script ID to search')
      .required('scriptId')
      .query(),
  ),
  tool('evidence_export_json', (t) =>
    t.desc('Export entire reverse evidence graph as JSON snapshot').query(),
  ),
  tool('evidence_export_markdown', (t) =>
    t.desc('Export reverse evidence graph as Markdown report grouped by node type').query(),
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
