import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { TRACE_TOOLS } from '@server/domains/trace/definitions.tools';

function findTool(name: string): Tool {
  const tool = TRACE_TOOLS.find((candidate) => candidate.name === name);
  expect(tool, `Expected tool "${name}" to exist`).toBeDefined();
  return tool as Tool;
}

describe('trace tool definitions', () => {
  it('contains lifecycle, query, and network-flow tools', () => {
    const names = new Set(TRACE_TOOLS.map((tool) => tool.name));

    expect(names.has('trace_recording')).toBe(true);
    expect(names.has('start_trace_recording')).toBe(true);
    expect(names.has('stop_trace_recording')).toBe(true);
    expect(names.has('query_trace_sql')).toBe(true);
    expect(names.has('seek_to_timestamp')).toBe(true);
    expect(names.has('trace_get_network_flow')).toBe(true);
    expect(names.has('trace_get_samples')).toBe(true);
    expect(names.has('summarize_trace')).toBe(true);
  });

  it('trace_get_network_flow requires requestId', () => {
    const tool = findTool('trace_get_network_flow');
    expect(tool.inputSchema.required).toContain('requestId');
  });

  it('trace_get_samples exposes mode enum with top default and query inputs', () => {
    const tool = findTool('trace_get_samples');
    const properties = (tool.inputSchema.properties ?? {}) as Record<
      string,
      { type?: string; enum?: string[]; default?: string }
    >;
    expect(properties['mode']?.enum).toEqual(['top', 'function', 'window']);
    expect(properties['mode']?.default).toBe('top');
    expect(properties['functionName']?.type).toBe('string');
    expect(properties['timestamp']?.type).toBe('number');
    expect(properties['windowMs']?.type).toBe('number');
    expect(properties['limit']?.type).toBe('number');
  });

  it('start_trace_recording exposes network capture controls', () => {
    const tool = findTool('start_trace_recording');
    const properties = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string }>;

    expect(properties['recordResponseBodies']?.type).toBe('boolean');
    expect(properties['streamResponseChunks']?.type).toBe('boolean');
    expect(properties['networkBodyMaxBytes']?.type).toBe('number');
    expect(properties['networkInlineBodyBytes']?.type).toBe('number');
  });
});
