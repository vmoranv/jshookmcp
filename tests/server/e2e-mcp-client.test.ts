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
  });

  it('does not collect performance metrics unless explicitly enabled', async () => {
    const client = new MCPTestClient();
    await client.connect();

    const { result } = await client.call('tool_alpha', { value: 1 }, 2000);

    expect(result.status).toBe('PASS');
    expect(result.performance).toBeUndefined();
  });

  it('records server-supplied execution metrics when explicitly enabled', async () => {
    process.env.E2E_COLLECT_PERFORMANCE = '1';
    state.callTool.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            _executionMetrics: {
              source: 'server',
              startedAt: '2026-01-01T00:00:00.000Z',
              finishedAt: '2026-01-01T00:00:00.250Z',
              elapsedMs: 250,
              timeoutMs: 2000,
              serverPid: 4321,
              cpuUserMicros: 1000,
              cpuSystemMicros: 500,
              memoryBefore: {
                source: 'server',
                rssBytes: 1000,
                privateBytes: null,
                virtualBytes: null,
                heapUsedBytes: 500,
                heapTotalBytes: 800,
                externalBytes: 10,
                arrayBuffersBytes: 5,
              },
              memoryAfter: {
                source: 'server',
                rssBytes: 1250,
                privateBytes: null,
                virtualBytes: null,
                heapUsedBytes: 650,
                heapTotalBytes: 800,
                externalBytes: 25,
                arrayBuffersBytes: 10,
              },
              memoryDelta: {
                rssBytes: 250,
                privateBytes: null,
                virtualBytes: null,
                heapUsedBytes: 150,
                heapTotalBytes: 0,
                externalBytes: 15,
                arrayBuffersBytes: 5,
              },
            },
          }),
        },
      ],
    });
    const client = new MCPTestClient();
    await client.connect();

    const { result } = await client.call('tool_alpha', { value: 1 }, 2000);

    expect(result.status).toBe('PASS');
    expect(result.performance).toBeDefined();
    expect(result.performance?.serverPid).toBe(4321);
    expect(result.performance?.timeoutMs).toBe(2000);
    expect(result.performance?.elapsedMs).toBe(250);
    expect(result.performance?.cpuUserMicros).toBe(1000);
    expect(result.performance?.cpuSystemMicros).toBe(500);
    expect(result.performance?.memoryBefore?.rssBytes).toBe(1000);
    expect(result.performance?.memoryAfter?.rssBytes).toBe(1250);
    expect(result.performance?.memoryDelta).toEqual({
      rssBytes: 250,
      privateBytes: null,
      virtualBytes: null,
      heapUsedBytes: 150,
      heapTotalBytes: 0,
      externalBytes: 15,
      arrayBuffersBytes: 5,
    });
  });
});
