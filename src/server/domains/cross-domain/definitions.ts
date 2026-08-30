import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const crossDomainToolDefinitions: Tool[] = [
  tool('cross_domain_capabilities', (t) =>
    t.desc('List all cross-domain capability categories and available workflows.').query(),
  ),
  tool('cross_domain_suggest_workflow', (t) =>
    t
      .desc('Recommend a multi-domain workflow to achieve a specific analysis goal.')
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
    t.desc('Report health status of cross-domain bridges and correlators.').query(),
  ),
  tool('cross_domain_correlate_all', (t) =>
    t
      .desc(
        'Run the built-in skia, mojo, syscall, and binary correlators and merge the results into the shared ' +
          'evidence graph.',
      )
      .boolean(
        'pullFromDomains',
        'When true, fetch missing correlator inputs from live domain buffers using available getter tools',
        { default: false },
      )
      .number(
        'minConfidence',
        'Minimum edge confidence to include in the returned evidence graph',
        {
          default: 0,
          minimum: 0,
          maximum: 1,
        },
      )
      .number(
        'maxEdgesPerType',
        'Maximum number of returned evidence edges per edge type; 0 means unlimited',
        { default: 0, minimum: 0 },
      )
      .prop('sceneTree', {
        type: 'object',
        description: 'Skia scene tree with layers and drawCommands',
        additionalProperties: true,
      })
      .array(
        'jsObjects',
        {
          type: 'object',
          additionalProperties: true,
        },
        'JS object descriptors for Skia correlation',
      )
      .array(
        'mojoMessages',
        {
          type: 'object',
          properties: {
            interface: { type: 'string' },
            method: { type: 'string' },
            timestamp: { type: 'number' },
            messageId: { type: 'string' },
          },
          required: ['interface', 'method', 'timestamp', 'messageId'],
        },
        'Mojo messages for MOJO-03 correlation',
      )
      .array(
        'cdpEvents',
        {
          type: 'object',
          properties: {
            eventType: { type: 'string' },
            timestamp: { type: 'number' },
            url: { type: 'string' },
          },
          required: ['eventType', 'timestamp'],
        },
        'CDP events for MOJO-03 correlation',
      )
      .array(
        'networkRequests',
        {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            url: { type: 'string' },
            timestamp: { type: 'number' },
          },
          required: ['requestId', 'url', 'timestamp'],
        },
        'Network requests for MOJO-03 correlation',
      )
      .array(
        'syscallEvents',
        {
          type: 'object',
          properties: {
            pid: { type: 'number' },
            tid: { type: 'number' },
            syscallName: { type: 'string' },
            timestamp: { type: 'number' },
          },
          required: ['pid', 'tid', 'syscallName', 'timestamp'],
        },
        'Syscall events for SYSCALL-02 correlation',
      )
      .array(
        'jsStacks',
        {
          type: 'object',
          properties: {
            threadId: { type: 'number' },
            timestamp: { type: 'number' },
            frames: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  functionName: { type: 'string' },
                },
                required: ['functionName'],
              },
            },
          },
          required: ['threadId', 'timestamp', 'frames'],
        },
        'JS stacks for SYSCALL-02 correlation',
      )
      .prop('ghidraOutput', {
        type: 'object',
        description: 'Binary analysis output with moduleName and functions',
        additionalProperties: true,
      }),
  ),
  tool('cross_domain_evidence_export', (t) =>
    t.desc('Export the shared cross-domain evidence graph as JSON.').query(),
  ),
  tool('cross_domain_evidence_query', (t) =>
    t
      .desc(
        'Query the shared evidence graph by URL, heap address, function, script, node type, metadata, or chain.',
      )
      .enum(
        'queryType',
        [
          'network_url',
          'heap_address',
          'function',
          'script_id',
          'node_id',
          'node_type',
          'metadata',
          'chain',
        ],
        'Evidence query mode',
      )
      .string('value', 'Primary query value, such as URL substring, heap address, node ID, or type')
      .string('metadataKey', 'Metadata key for queryType=metadata')
      .string('metadataValue', 'Optional exact metadata value for queryType=metadata')
      .enum('direction', ['forward', 'backward'], 'Traversal direction for queryType=chain')
      .number('limit', 'Maximum nodes to return', { default: 50, minimum: 1, maximum: 500 })
      .required('queryType')
      .query(),
  ),
  tool('cross_domain_evidence_stats', (t) =>
    t.desc('Get node and edge statistics for the shared cross-domain evidence graph.').query(),
  ),
  tool('cross_domain_synonym', (t) =>
    t
      .desc(
        'Map natural-language queries to tool recommendations using a lightweight synonym graph. ' +
          'Pure TS — no LLM. Useful for discovering which tools implement a concept described in ' +
          'plain English (e.g. "find where the app signs requests" → deobfuscation, crypto, network).',
      )
      .string('query', 'Natural-language description of the task or concept to find tools for')
      .number('maxResults', 'Maximum results to return', { default: 10, minimum: 1, maximum: 20 })
      .required('query')
      .query(),
  ),
];
