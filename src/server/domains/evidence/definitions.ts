import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const evidenceTools: Tool[] = [
  tool('evidence_query_url')
    .desc('Query reverse evidence graph for all nodes associated with a URL')
    .string('url', 'URL or URL fragment to search')
    .required('url')
    .readOnly()
    .idempotent()
    .build(),

  tool('evidence_query_function')
    .desc('Query reverse evidence graph for all nodes associated with a function name')
    .string('name', 'Function name or fragment to search')
    .required('name')
    .readOnly()
    .idempotent()
    .build(),

  tool('evidence_query_script')
    .desc('Query reverse evidence graph for all nodes associated with a script ID')
    .string('scriptId', 'Script ID to search')
    .required('scriptId')
    .readOnly()
    .idempotent()
    .build(),

  tool('evidence_export_json')
    .desc('Export entire reverse evidence graph as JSON snapshot')
    .readOnly()
    .idempotent()
    .build(),

  tool('evidence_export_markdown')
    .desc('Export reverse evidence graph as Markdown report grouped by node type')
    .readOnly()
    .idempotent()
    .build(),

  tool('evidence_chain')
    .desc('Get full provenance chain from a node ID in specified direction')
    .string('nodeId', 'Evidence node ID to start from')
    .enum('direction', ['forward', 'backward'], 'Traversal direction', { default: 'forward' })
    .required('nodeId')
    .readOnly()
    .idempotent()
    .build(),
];
