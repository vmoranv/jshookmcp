import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const crossDomainToolDefinitions: Tool[] = [
  tool('cross_domain_capabilities', (t) =>
    t.desc('List cross-domain capabilities and workflows.').query(),
  ),
  tool('cross_domain_suggest_workflow', (t) =>
    t
      .desc('Suggest a cross-domain workflow for a goal.')
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
  tool('cross_domain_health', (t) => t.desc('Report cross-domain health.').query()),
  tool('cross_domain_correlate_all', (t) =>
    t
      .desc(
        'Run the built-in skia, mojo, syscall, and binary correlators and merge the results into the shared evidence graph.',
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
  tool('cross_domain_evidence_stats', (t) =>
    t.desc('Get node and edge statistics for the shared cross-domain evidence graph.').query(),
  ),
];
