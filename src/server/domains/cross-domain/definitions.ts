import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const crossDomainToolDefinitions: Tool[] = [
  tool('cross_domain_capabilities', (t) =>
    t
      .desc(
        'List cross-domain capabilities, supported v5.0 domains, and available mission workflows.',
      )
      .query(),
  ),
  tool('cross_domain_suggest_workflow', (t) =>
    t
      .desc('Suggest the best cross-domain workflow for a reverse-engineering goal.')
      .string('goal', 'High-level task goal or problem statement to classify')
      .boolean(
        'preferAvailableOnly',
        'Prefer workflows whose dependent domains are currently enabled',
        {
          default: true,
        },
      )
      .required('goal')
      .query(),
  ),
  tool('cross_domain_health', (t) =>
    t
      .desc('Report cross-domain health, enabled v5.0 domains, and evidence-graph availability.')
      .query(),
  ),
  tool('cross_domain_correlate_all', (t) =>
    t
      .desc(
        'Ingest artifacts from V8, network, canvas, syscall, mojo, and binary domains into one shared evidence graph with optional cross-links.',
      )
      .array(
        'v8Objects',
        {
          type: 'object',
          properties: {
            address: { type: 'string' },
            size: { type: 'number' },
            type: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['address', 'size', 'type', 'name'],
        },
        'Optional V8 heap objects to import first',
      )
      .array(
        'networkRequests',
        {
          type: 'object',
          properties: {
            url: { type: 'string' },
            method: { type: 'string' },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
            initiatorHeapIndex: { type: 'number' },
          },
          required: ['url', 'method'],
        },
        'Optional network requests. Use initiatorHeapIndex to link a request to v8Objects[index].',
      )
      .array(
        'canvasNodes',
        {
          type: 'object',
          properties: {
            nodeId: { type: 'string' },
            type: { type: 'string' },
            label: { type: 'string' },
            creatorHeapIndex: { type: 'number' },
          },
          required: ['nodeId', 'type', 'label'],
        },
        'Optional canvas nodes. Use creatorHeapIndex to link to v8Objects[index].',
      )
      .array(
        'binarySymbols',
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: { type: 'string' },
            module: { type: 'string' },
          },
          required: ['name', 'address', 'module'],
        },
        'Optional binary symbols to import before syscall correlation.',
      )
      .array(
        'syscallEvents',
        {
          type: 'object',
          properties: {
            syscall: { type: 'string' },
            pid: { type: 'number' },
            timestamp: { type: 'number' },
            jsFunctionSymbolIndex: { type: 'number' },
          },
          required: ['syscall', 'pid', 'timestamp'],
        },
        'Optional syscall events. Use jsFunctionSymbolIndex to link to binarySymbols[index].',
      )
      .array(
        'mojoMessages',
        {
          type: 'object',
          properties: {
            interfaceName: { type: 'string' },
            messageType: { type: 'string' },
            payload: { description: 'Any JSON-serializable payload object' },
            sourceRequestIndex: { type: 'number' },
          },
          required: ['interfaceName', 'messageType', 'payload'],
        },
        'Optional Mojo IPC messages. Use sourceRequestIndex to link to networkRequests[index].',
      ),
  ),
  tool('cross_domain_evidence_export', (t) =>
    t.desc('Export the shared cross-domain evidence graph as JSON.').query(),
  ),
  tool('cross_domain_evidence_stats', (t) =>
    t.desc('Get node and edge statistics for the shared cross-domain evidence graph.').query(),
  ),
];
