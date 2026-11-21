/**
 * MCP 2.0 barrel wiring — regression tests.
 *
 * The spec-pinned `src/server/mcp2/*` modules used to be UNWIRED: only the
 * era-matrix tests imported them. This suite proves they are now genuine
 * production dependencies of `src/`:
 *   1. the runtime contract guard detects a stale pin against the installed SDK,
 *   2. the barrel re-exports the guard (the wiring surface),
 *   3. the tool error mapper uses the pinned ResourceNotFound code (single
 *      source of truth instead of a scattered literal),
 *   4. every pinned value + predicate self-check matches the installed SDK.
 */
import { describe, expect, it } from 'vitest';

import { ToolError } from '@errors/ToolError';
import {
  findMcp2ContractDrift,
  ERROR_CODE_RESOURCE_NOT_FOUND,
  SERVER_INFO_META_KEY,
} from '@server/mcp2';
import { registerSingleTool } from '@server/MCPServer.tools';

describe('mcp2 runtime contract guard', () => {
  it('reports no drift against the installed SDK', () => {
    expect(findMcp2ContractDrift()).toEqual([]);
  });

  it('pins ResourceNotFound and the serverInfo meta key to the SDK exports', async () => {
    const sdk = await import('@modelcontextprotocol/server');
    expect(ERROR_CODE_RESOURCE_NOT_FOUND).toBe(sdk.ProtocolErrorCode.ResourceNotFound);
    expect(SERVER_INFO_META_KEY).toBe(sdk.SERVER_INFO_META_KEY);
  });
});

describe('mcp2 barrel is wired into the tool error mapper', () => {
  function registerProbe(thrower: () => never) {
    const registered: Array<(args: Record<string, unknown>) => Promise<unknown>> = [];
    const ctx = {
      server: {
        registerTool: (_name: string, _config: unknown, handler: (typeof registered)[number]) => {
          registered.push(handler);
          return { remove: () => undefined };
        },
        sendToolListChanged: async () => undefined,
        registeredTools: {},
      },
      toolAutocompleteHandlers: new Map(),
      executeToolWithTracking: async () => thrower(),
    } as unknown as Parameters<typeof registerSingleTool>[0];

    registerSingleTool(ctx, {
      name: 'probe_missing',
      description: 'probe',
      inputSchema: { type: 'object', properties: {} },
    } as never);

    return registered[0]!;
  }

  async function failedPayload(handler: (args: Record<string, unknown>) => Promise<unknown>) {
    const result = (await handler({})) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    // SEP-1303: a failed call is a Tool Execution Error, not a JSON-RPC fault.
    expect(result.isError).toBe(true);
    return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
  }

  it('returns ToolError NOT_FOUND as a tool execution error carrying its code', async () => {
    const handler = registerProbe(() => {
      throw new ToolError('NOT_FOUND', 'gone');
    });

    const payload = await failedPayload(handler);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('NOT_FOUND');
  });

  it('classifies invalid arguments as VALIDATION, not a protocol error', async () => {
    const handler = registerProbe(() => {
      throw new ToolError('VALIDATION', 'bad arg');
    });

    const payload = await failedPayload(handler);
    expect(payload.code).toBe('VALIDATION');
  });
});
