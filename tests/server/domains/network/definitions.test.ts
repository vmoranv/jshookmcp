import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { advancedTools } from '@server/domains/network/definitions';

type ToolProperty = {
  type?: string;
  description?: string;
};

function findTool(name: string): Tool {
  const tool = advancedTools.find((candidate) => candidate.name === name);
  expect(tool, `Expected tool "${name}" to exist`).toBeDefined();
  return tool as Tool;
}

function getProperties(tool: Tool): Record<string, ToolProperty> {
  expect(
    tool.inputSchema.properties,
    `${tool.name} should define inputSchema.properties`,
  ).toBeDefined();

  return (tool.inputSchema.properties ?? {}) as Record<string, ToolProperty>;
}

describe('network tool definitions', () => {
  it('exports a non-empty array of tool definitions', () => {
    expect(Array.isArray(advancedTools)).toBe(true);
    expect(advancedTools.length).toBeGreaterThan(0);
  });

  it('every tool has a name, description, and inputSchema', () => {
    for (const tool of advancedTools) {
      expect(tool.name).toEqual(expect.any(String));
      expect(tool.name.length).toBeGreaterThan(0);

      expect(tool.description).toEqual(expect.any(String));
      expect((tool.description ?? '').length).toBeGreaterThan(0);

      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('has no duplicate tool names', () => {
    const names = advancedTools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('tool names use snake_case convention', () => {
    for (const tool of advancedTools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('contains expected core network tools', () => {
    const names = new Set(advancedTools.map((t) => t.name));
    expect(names.has('network_enable')).toBe(true);
    expect(names.has('network_disable')).toBe(true);
    expect(names.has('network_get_status')).toBe(true);
    expect(names.has('network_monitor')).toBe(true);
    expect(names.has('network_get_requests')).toBe(true);
    expect(names.has('network_get_response_body')).toBe(true);
    expect(names.has('network_get_stats')).toBe(true);
  });

  it('contains expected raw DNS and HTTP tools', () => {
    const names = new Set(advancedTools.map((t) => t.name));

    expect(names.has('http_request_build')).toBe(true);
    expect(names.has('http_plain_request')).toBe(true);
  });

  it('contains expected performance tools', () => {
    const names = new Set(advancedTools.map((t) => t.name));
    expect(names.has('performance_get_metrics')).toBe(true);
    expect(names.has('performance_coverage')).toBe(true);
    expect(names.has('performance_take_heap_snapshot')).toBe(true);
    expect(names.has('performance_trace')).toBe(true);
  });

  it('contains expected profiler tools', () => {
    const names = new Set(advancedTools.map((t) => t.name));
    expect(names.has('profiler_cpu')).toBe(true);
    expect(names.has('profiler_heap_sampling')).toBe(true);
  });

  it('contains expected console tools', () => {
    const names = new Set(advancedTools.map((t) => t.name));
    expect(names.has('console_get_exceptions')).toBe(true);
    expect(names.has('console_inject')).toBe(true);
    expect(names.has('console_buffers')).toBe(true);
  });

  it('contains expected analysis tools', () => {
    const names = new Set(advancedTools.map((t) => t.name));
    expect(names.has('network_extract_auth')).toBe(true);

    expect(names.has('http_request_build')).toBe(true);
    expect(names.has('http_plain_request')).toBe(true);
    expect(names.has('network_export_har')).toBe(true);
    expect(names.has('network_replay_request')).toBe(true);
    expect(names.has('network_intercept')).toBe(true);
  });

  // ---------- required field checks ----------

  it('network_get_response_body requires requestId', () => {
    const tool = findTool('network_get_response_body');
    expect(tool.inputSchema.required).toContain('requestId');
  });

  it('network_monitor requires action', () => {
    const tool = findTool('network_monitor');
    expect(tool.inputSchema.required).toContain('action');
  });

  it('network_replay_request requires requestId', () => {
    const tool = findTool('network_replay_request');
    expect(tool.inputSchema.required).toContain('requestId');
  });

  it('http_request_build requires method and target', () => {
    const tool = findTool('http_request_build');
    expect(tool.inputSchema.required).toContain('method');
    expect(tool.inputSchema.required).toContain('target');
  });

  it('http_plain_request requires host and requestText', () => {
    const tool = findTool('http_plain_request');
    expect(tool.inputSchema.required).toContain('host');
    expect(tool.inputSchema.required).toContain('requestText');
  });

  it('network_replay_request exposes request-level authorization inputs', () => {
    const tool = findTool('network_replay_request');
    const props = getProperties(tool);

    expect(props.authorization).toBeDefined();
    expect(props.authorization?.type).toBe('object');
    expect(props.authorizationCapability).toBeDefined();
    expect(props.authorizationCapability?.type).toBe('string');
  });

  it('http_plain_request exposes request-level authorization inputs', () => {
    const tool = findTool('http_plain_request');
    const props = getProperties(tool);

    expect(props.authorization).toBeDefined();
    expect(props.authorization?.type).toBe('object');
    expect(props.timeoutMs).toBeDefined();
    expect(props.maxResponseBytes).toBeDefined();
  });

  it('console_inject requires type', () => {
    const tool = findTool('console_inject');
    expect(tool.inputSchema.required).toContain('type');
  });

  // ---------- property type checks ----------

  it('network_get_requests has expected filter properties', () => {
    const tool = findTool('network_get_requests');
    const props = getProperties(tool);
    expect(props.url).toBeDefined();
    expect(props.urlRegex).toBeDefined();
    expect(props.method).toBeDefined();
    expect(props.sinceTimestamp).toBeDefined();
    expect(props.sinceRequestId).toBeDefined();
    expect(props.tail).toBeDefined();
    expect(props.limit).toBeDefined();
    expect(props.offset).toBeDefined();
    expect(props.autoEnable).toBeDefined();
    expect(props.enableExceptions).toBeDefined();
  });

  it('performance_trace has action, categories, screenshots, artifactPath', () => {
    const tool = findTool('performance_trace');
    const props = getProperties(tool);
    expect(props.action).toBeDefined();
    expect(props.categories).toBeDefined();
    expect(props.categories?.type).toBe('array');
    expect(props.screenshots).toBeDefined();
    expect(props.screenshots?.type).toBe('boolean');
  });

  it('profiler_heap_sampling has samplingInterval property', () => {
    const tool = findTool('profiler_heap_sampling');
    const props = getProperties(tool);
    expect(props.samplingInterval).toBeDefined();
    expect(props.samplingInterval?.type).toBe('number');
  });

  it('http_request_build exposes expected builder properties', () => {
    const tool = findTool('http_request_build');
    const props = getProperties(tool);
    expect(props.host).toBeDefined();
    expect(props.headers).toBeDefined();
    expect(props.body).toBeDefined();
    expect(props.httpVersion).toBeDefined();
    expect(props.addHostHeader).toBeDefined();
    expect(props.addContentLength).toBeDefined();
    expect(props.addConnectionClose).toBeDefined();
  });

  it('all inputSchema.properties entries have a type field', () => {
    for (const tool of advancedTools) {
      const props = getProperties(tool);
      for (const [key, value] of Object.entries(props)) {
        expect(value.type, `${tool.name}.properties.${key} should have a type`).toBeDefined();
      }
    }
  });

  it('all inputSchema.properties entries have a description field', () => {
    for (const tool of advancedTools) {
      const props = getProperties(tool);
      for (const [key, value] of Object.entries(props)) {
        expect(
          value.description,
          `${tool.name}.properties.${key} should have a description`,
        ).toBeDefined();
        expect(typeof value.description).toBe('string');
      }
    }
  });

  it('required fields reference properties that exist in the schema', () => {
    for (const tool of advancedTools) {
      const required = tool.inputSchema.required;
      if (!required) continue;
      const propNames = Object.keys(getProperties(tool));
      for (const field of required) {
        expect(
          propNames,
          `${tool.name}: required field "${field}" must exist in properties`,
        ).toContain(field);
      }
    }
  });
});
