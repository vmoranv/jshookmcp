import { describe, expect, it, beforeEach } from 'vitest';
import {
  ToolCallContextGuard,
  getToolExecutionComplexity,
  normalizeSemanticArgs,
  buildGasBudgetErrorResponse,
  buildIsomorphicLoopErrorResponse,
} from '@server/ToolCallContextGuard';

describe('Execution Complexity Gas Meter & Isomorphic Loop Breaker', () => {
  let guard: ToolCallContextGuard;

  beforeEach(() => {
    guard = new ToolCallContextGuard(() => null);
    guard.resetExecutionBudgetForTesting();
  });

  describe('getToolExecutionComplexity', () => {
    it('rates heavy decompilation and memory scanning tools as 25 gas', () => {
      expect(getToolExecutionComplexity('ghidra_decompile')).toBe(25);
      expect(getToolExecutionComplexity('jadx_decompile_apk')).toBe(25);
      expect(getToolExecutionComplexity('frida_memory_scan')).toBe(25);
      expect(getToolExecutionComplexity('js_symbolic_execute')).toBe(25);
      expect(getToolExecutionComplexity('nemu_call_symbol')).toBe(25);
    });

    it('rates interactive actions as 5 gas', () => {
      expect(getToolExecutionComplexity('page_navigate')).toBe(5);
      expect(getToolExecutionComplexity('adb_shell')).toBe(5);
      expect(getToolExecutionComplexity('network_monitor')).toBe(5);
    });

    it('rates lightweight meta and query tools as 1 gas', () => {
      expect(getToolExecutionComplexity('search_tools')).toBe(1);
      expect(getToolExecutionComplexity('describe_tool')).toBe(1);
      expect(getToolExecutionComplexity('get_detailed_data')).toBe(1);
    });

    it('promotes measured subprocess/worker/poll-heavy tools above 1 gas', () => {
      // These were gas=1 under the old name-only heuristic despite 60-240ms
      // measured cold single-call cost (spawns, WASM pools, polls, cold imports).
      expect(getToolExecutionComplexity('platform_capabilities')).toBe(25);
      expect(getToolExecutionComplexity('wasm_offline_run')).toBe(25);
      expect(getToolExecutionComplexity('process_find')).toBe(25);
      expect(getToolExecutionComplexity('crypto_test_harness')).toBe(25);
      expect(getToolExecutionComplexity('crypto_compare')).toBe(25);
      expect(getToolExecutionComplexity('tasks_result')).toBe(25);
      expect(getToolExecutionComplexity('net_raw_tcp_listen')).toBe(25);
      expect(getToolExecutionComplexity('browser_jsdom_parse')).toBe(25);
    });

    it('keeps unmeasured-name heavy tiers as a conservative ceiling', () => {
      // High tier is a resource ceiling, not a latency claim: do not lower fast
      // exploit/nemu members just because a single benchmark call was quick.
      expect(getToolExecutionComplexity('exploit_build_heap_spray')).toBe(25);
      expect(getToolExecutionComplexity('nemu_bytecode_decode')).toBe(25);
    });
  });

  describe('normalizeSemanticArgs', () => {
    it('strips ephemeral metadata keys like comment, description, timestamp, nonce, _meta', () => {
      const args1 = {
        target: '0x1234',
        comment: 'first attempt',
        timestamp: 1700000001,
        _meta: { token: 'abc' },
      };
      const args2 = {
        target: '0x1234',
        comment: 'second attempt with different comment',
        timestamp: 1700000002,
        _meta: { token: 'xyz' },
      };

      expect(normalizeSemanticArgs(args1)).toBe(normalizeSemanticArgs(args2));
      expect(JSON.parse(normalizeSemanticArgs(args1))).toEqual({ target: '0x1234' });
    });
  });

  describe('recordExecutionCost (Gas Budget)', () => {
    it('tracks accumulated gas and trips when exceeding window limit', () => {
      const config = { maxWindowUnits: 50, windowMs: 10_000 };

      // Call 2 heavy tools: 2 * 25 = 50 (at limit, not yet exceeded)
      expect(guard.recordExecutionCost('ghidra_decompile', config)).toBeNull();
      expect(guard.recordExecutionCost('jadx_decompile_apk', config)).toBeNull();

      // Third call puts total at 51 (> 50) -> trips!
      const trip = guard.recordExecutionCost('search_tools', config);
      expect(trip).not.toBeNull();
      expect(trip?.usedCost).toBe(51);
      expect(trip?.limit).toBe(50);
      expect(trip?.resetInMs).toBeGreaterThan(0);
    });

    it('returns null when limit is 0 (disabled)', () => {
      expect(guard.recordExecutionCost('ghidra_decompile', { maxWindowUnits: 0 })).toBeNull();
    });
  });

  describe('recordIsomorphicCall', () => {
    it('trips when agent mutates cosmetic arguments consecutively', () => {
      const t1 = guard.recordIsomorphicCall(
        'frida_memory_scan',
        {
          address: '0x4000',
          comment: 'try 1',
        },
        3,
      );
      expect(t1).toBeNull();

      const t2 = guard.recordIsomorphicCall(
        'frida_memory_scan',
        {
          address: '0x4000',
          comment: 'try 2 with different words',
        },
        3,
      );
      expect(t2).toBeNull();

      const t3 = guard.recordIsomorphicCall(
        'frida_memory_scan',
        {
          address: '0x4000',
          comment: 'try 3 mutated again',
        },
        3,
      );
      expect(t3).not.toBeNull();
      expect(t3?.count).toBe(3);
    });

    it('resets streak when core functional argument changes', () => {
      guard.recordIsomorphicCall('frida_memory_scan', { address: '0x4000', comment: 'c1' }, 3);
      guard.recordIsomorphicCall('frida_memory_scan', { address: '0x4000', comment: 'c2' }, 3);

      // Change address!
      guard.recordIsomorphicCall('frida_memory_scan', { address: '0x5000', comment: 'c3' }, 3);

      const trip = guard.recordIsomorphicCall(
        'frida_memory_scan',
        { address: '0x5000', comment: 'c4' },
        3,
      );
      expect(trip).toBeNull(); // streak was reset to 2 for 0x5000
    });
  });

  describe('Error response builders', () => {
    it('builds clear gas budget error response', () => {
      const trip = { usedCost: 60, limit: 50, resetInMs: 4500 };
      const response = buildGasBudgetErrorResponse('ghidra_decompile', trip);

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0]!.text);
      expect(parsed.gasBudget.usedCost).toBe(60);
      expect(parsed.gasBudget.retryAfterSeconds).toBe(5);
    });

    it('builds clear isomorphic loop error response', () => {
      const trip = { count: 4, threshold: 4, semanticSignature: 'sig' };
      const response = buildIsomorphicLoopErrorResponse('page_evaluate', trip);

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0]!.text);
      expect(parsed.isomorphicLoop.consecutiveCount).toBe(4);
    });
  });
});
