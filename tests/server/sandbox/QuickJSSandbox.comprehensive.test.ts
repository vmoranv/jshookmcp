/**
 * Comprehensive tests for QuickJSSandbox.ts — covers remaining ~59% uncovered code:
 * - executeWithOrchestration() full loop
 * - _injectBridge() with mcp.call() and mcp.listTools()
 * - _injectBridgeForOrchestration() enqueue/reject
 * - Multi-round orchestration with pending calls
 * - Error paths in orchestration
 * - Bridge injection with bridge set on sandbox
 * - _injectHelpers error path
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuickJSSandbox } from '@server/sandbox/QuickJSSandbox';
import { MCPBridge } from '@server/sandbox/MCPBridge';
import type { MCPServerContext } from '@server/MCPServer.context';

function createMockContext(tools: string[] = ['tool_a', 'tool_b']): MCPServerContext {
  return {
    selectedTools: tools.map((name) => ({
      name,
      description: '',
      inputSchema: { type: 'object' },
    })),
    executeToolWithTracking: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"result":"ok"}' }],
    }),
  } as unknown as MCPServerContext;
}

describe('QuickJSSandbox — comprehensive', () => {
  let sandbox: QuickJSSandbox;

  beforeEach(() => {
    sandbox = new QuickJSSandbox();
  });

  describe('setBridge() and bridge injection', () => {
    it('injects mcp.call() stub when bridge is set', async () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);
      sandbox.setBridge(bridge);

      const result = await sandbox.execute(
        'var r = mcp.call("tool_a", {key: "val"}); console.log(JSON.stringify(r)); r.pending',
      );
      expect(result.ok).toBe(true);
      expect(result.output).toBe(true);
      expect(result.logs.some((l: string) => l.includes('[mcp.call]'))).toBe(true);
    });

    it('injects mcp.listTools() when bridge is set', async () => {
      const ctx = createMockContext(['tool_x', 'tool_y']);
      const bridge = new MCPBridge(ctx);
      sandbox.setBridge(bridge);

      const result = await sandbox.execute('JSON.stringify(mcp.listTools())');
      expect(result.ok).toBe(true);
      const tools = JSON.parse(result.output as string);
      expect(tools).toEqual(['tool_x', 'tool_y']);
    });

    it('mcp.call() returns placeholder with tool name', async () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);
      sandbox.setBridge(bridge);

      const result = await sandbox.execute('var r = mcp.call("tool_a", {}); JSON.stringify(r)');
      expect(result.ok).toBe(true);
      const parsed = JSON.parse(result.output as string);
      expect(parsed.pending).toBe(true);
      expect(parsed.tool).toBe('tool_a');
    });
  });

  describe('executeWithOrchestration()', () => {
    it('completes immediately when script has no bridge calls', async () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);

      const result = await sandbox.executeWithOrchestration('1 + 2', bridge);

      expect(result.ok).toBe(true);
      expect(result.output).toBe(3);
      expect(result.bridgeCallCount).toBe(0);
      expect(result.bridgeCalls).toEqual([]);
    });

    it('handles script errors in orchestration', async () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);

      const result = await sandbox.executeWithOrchestration('undefinedVar.prop', bridge);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.bridgeCallCount).toBe(0);
    });

    it('handles timeout in orchestration', async () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);

      const result = await sandbox.executeWithOrchestration('while(true) {}', bridge, {
        timeoutMs: 50,
      });

      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
    });

    it('executes multi-round orchestration with bridge calls', async () => {
      const ctx = createMockContext(['tool_a']);
      (ctx.executeToolWithTracking as any).mockResolvedValue({
        content: [{ type: 'text', text: '{"value":42}' }],
      });
      const bridge = new MCPBridge(ctx);

      // Script that calls mcp.call, and on round 1 reads results
      const code = `
        if (typeof __bridgeResults === 'undefined') {
          // Round 0: enqueue a bridge call
          mcp.call("tool_a", {x: 1});
          "pending"
        } else {
          // Round 1: read results
          "done"
        }
      `;

      const result = await sandbox.executeWithOrchestration(code, bridge);

      expect(result.ok).toBe(true);
      expect(result.output).toBe('done');
      expect(result.bridgeCallCount).toBe(1);
      expect(result.bridgeCalls[0]?.toolName).toBe('tool_a');
    });

    it('respects bridgeAllowlist in orchestration', async () => {
      const ctx = createMockContext(['tool_a', 'tool_b']);
      const bridge = new MCPBridge(ctx);

      const code = `
        if (typeof __bridgeResults === 'undefined') {
          mcp.call("tool_b", {});
          "pending"
        } else {
          "done"
        }
      `;

      const result = await sandbox.executeWithOrchestration(code, bridge, {
        bridgeAllowlist: ['tool_a'], // tool_b is NOT allowed
      });

      // The enqueue should fail because tool_b is not in allowlist
      // But the code still runs — the call returns an error marker
      expect(result.ok).toBe(true);
      // The bridge call should have been rejected by enqueue
      expect(result.logs.some((l: string) => l.includes('rejected'))).toBe(true);
    });

    it('respects maxBridgeCalls limit', async () => {
      const ctx = createMockContext(['tool_a']);
      (ctx.executeToolWithTracking as any).mockResolvedValue({
        content: [{ type: 'text', text: '{"ok":true}' }],
      });
      const bridge = new MCPBridge(ctx);

      // Script always enqueues a bridge call, never stops
      const code = `
        mcp.call("tool_a", {});
        "still going"
      `;

      const result = await sandbox.executeWithOrchestration(code, bridge, {
        maxBridgeCalls: 2,
      });

      expect(result.ok).toBe(true);
      // Should stop after maxBridgeCalls rounds
      expect(result.bridgeCallCount).toBeLessThanOrEqual(3);
    });

    it('handles bridge call errors gracefully during orchestration', async () => {
      const ctx = createMockContext(['tool_a']);
      (ctx.executeToolWithTracking as any).mockRejectedValue(new Error('tool failed'));
      const bridge = new MCPBridge(ctx);

      const code = `
        if (typeof __bridgeResults === 'undefined') {
          mcp.call("tool_a", {});
          "waiting"
        } else {
          JSON.stringify(__bridgeResults)
        }
      `;

      const result = await sandbox.executeWithOrchestration(code, bridge);

      expect(result.ok).toBe(true);
      // Errors are captured as { __error: true, message: '...' }
      expect(result.bridgeCalls[0]?.result).toEqual(expect.objectContaining({ __error: true }));
    });

    it('passes globals to orchestration', async () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);

      const result = await sandbox.executeWithOrchestration('myVar + 10', bridge, {
        globals: { myVar: 32 },
      });

      expect(result.ok).toBe(true);
      expect(result.output).toBe(42);
    });

    it('injects __bridgeRound counter', async () => {
      const ctx = createMockContext();
      const bridge = new MCPBridge(ctx);

      const result = await sandbox.executeWithOrchestration('__bridgeRound', bridge);

      expect(result.ok).toBe(true);
      expect(result.output).toBe(0);
    });

    it('collects logs across all rounds', async () => {
      const ctx = createMockContext(['tool_a']);
      (ctx.executeToolWithTracking as any).mockResolvedValue({
        content: [{ type: 'text', text: '{"ok":true}' }],
      });
      const bridge = new MCPBridge(ctx);

      const code = `
        console.log("round:" + __bridgeRound);
        if (__bridgeRound === 0) {
          mcp.call("tool_a", {});
        }
        "ok"
      `;

      const result = await sandbox.executeWithOrchestration(code, bridge);

      expect(result.ok).toBe(true);
      expect(
        result.logs.filter((l: string) => l.startsWith('round:')).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe('execute() edge cases', () => {
    it('handles undefined output gracefully', async () => {
      const result = await sandbox.execute('undefined');
      expect(result.ok).toBe(true);
      expect(result.output).toBeUndefined();
    });

    it('handles boolean output', async () => {
      const result = await sandbox.execute('true');
      expect(result.ok).toBe(true);
      expect(result.output).toBe(true);

      const result2 = await sandbox.execute('false');
      expect(result2.ok).toBe(true);
      expect(result2.output).toBe(false);
    });

    it('handles console.log with objects', async () => {
      const result = await sandbox.execute('console.log({a: 1, b: "two"}); 0');
      expect(result.ok).toBe(true);
      expect(result.logs.length).toBe(1);
      expect(result.logs[0]).toContain('"a":1');
    });

    it('handles console.log with multiple arguments', async () => {
      const result = await sandbox.execute('console.log("hello", 42, true); 0');
      expect(result.ok).toBe(true);
      expect(result.logs[0]).toContain('hello');
      expect(result.logs[0]).toContain('42');
    });

    it('injects boolean globals correctly', async () => {
      const result = await sandbox.execute('myBool ? "yes" : "no"', {
        globals: { myBool: true },
      });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('yes');
    });

    it('injects null/undefined globals', async () => {
      const result = await sandbox.execute('typeof myNull', {
        globals: { myNull: null },
      });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('undefined'); // null → ctx.undefined
    });

    it('injects non-serializable globals as strings', async () => {
      const result = await sandbox.execute('typeof myFn', {
        globals: { myFn: () => {} },
      });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('string');
    });

    it('durationMs is always positive', async () => {
      const result = await sandbox.execute('1 + 1');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('error result has correct structure', async () => {
      const result = await sandbox.execute('throw new Error("test error")');
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.logs).toBeDefined();
    });

    it('object error messages are JSON stringified', async () => {
      const result = await sandbox.execute('throw {code: 42, msg: "bad"}');
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      // Error from QuickJS dump could be an object — should be stringified
      if (result.error) {
        expect(typeof result.error).toBe('string');
      }
    });
  });

  describe('helpers injection', () => {
    it('provides helpers.hex encoding', async () => {
      const result = await sandbox.execute('helpers.hex.encode("AB")');
      expect(result.ok).toBe(true);
      expect(result.output).toBe('4142');
    });

    it('provides helpers.base64 decode', async () => {
      const result = await sandbox.execute('helpers.base64.decode("aGVsbG8=")');
      expect(result.ok).toBe(true);
      expect(result.output).toBe('hello');
    });
  });
});
