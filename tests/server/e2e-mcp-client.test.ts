import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  listTools: vi.fn(async () => ({
    tools: [{ name: 'tool_alpha', inputSchema: { type: 'object', properties: {} } }],
  })),
  callTool: vi.fn(async () => ({
    content: [{ type: 'text', text: '{"success":true}' }],
  })),
  closeTransport: vi.fn(async () => undefined),
  sampleProcessMemory: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    connect = state.connect;
    listTools = state.listTools;
    callTool = state.callTool;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioClientTransport {
    _process = { pid: 4321 };
    close = state.closeTransport;
  },
}));

vi.mock('@tests/e2e/helpers/perf-metrics', async () => {
  const actual = await vi.importActual<typeof import('@tests/e2e/helpers/perf-metrics')>(
    '@tests/e2e/helpers/perf-metrics',
  );
  return {
    ...actual,
    sampleProcessMemory: state.sampleProcessMemory,
  };
});

import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

describe('e2e MCPTestClient performance metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.E2E_COLLECT_PERFORMANCE;
    state.connect.mockResolvedValue(undefined);
    state.listTools.mockResolvedValue({
      tools: [{ name: 'tool_alpha', inputSchema: { type: 'object', properties: {} } }],
    });
    state.callTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
    });
    state.sampleProcessMemory
      .mockResolvedValueOnce({
        source: 'procfs',
        rssBytes: 1000,
        privateBytes: 500,
        virtualBytes: 4000,
      })
      .mockResolvedValueOnce({
        source: 'procfs',
        rssBytes: 1250,
        privateBytes: 650,
        virtualBytes: 4300,
      });
  });

  it('does not collect performance metrics unless explicitly enabled', async () => {
    const client = new MCPTestClient();
    await client.connect();

    const { result } = await client.call('tool_alpha', { value: 1 }, 2000);

    expect(result.status).toBe('PASS');
    expect(result.performance).toBeUndefined();
    expect(state.sampleProcessMemory).not.toHaveBeenCalled();
  });

  it('records elapsed time and process memory deltas when explicitly enabled', async () => {
    process.env.E2E_COLLECT_PERFORMANCE = '1';
    const client = new MCPTestClient();
    await client.connect();

    const { result } = await client.call('tool_alpha', { value: 1 }, 2000);

    expect(result.status).toBe('PASS');
    expect(result.performance).toBeDefined();
    expect(result.performance?.serverPid).toBe(4321);
    expect(result.performance?.timeoutMs).toBe(2000);
    expect(result.performance?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.performance?.memoryBefore?.rssBytes).toBe(1000);
    expect(result.performance?.memoryAfter?.rssBytes).toBe(1250);
    expect(result.performance?.memoryDelta).toEqual({
      rssBytes: 250,
      privateBytes: 150,
      virtualBytes: 300,
    });
  });
});
