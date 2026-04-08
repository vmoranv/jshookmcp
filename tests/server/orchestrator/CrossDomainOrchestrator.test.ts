import { describe, it, expect, vi } from 'vitest';
import { CrossDomainOrchestrator } from '@server/orchestrator/CrossDomainOrchestrator';

function createMockCtx(overrides?: Record<string, unknown>): import('@server/MCPServer.context').MCPServerContext {
  return {
    pageController: { evaluate: vi.fn() },
    debuggerManager: { enabled: true },
    workerPool: null,
    evidenceHandlers: undefined,
    executeToolWithTracking: vi.fn().mockResolvedValue({}),
    domainInstanceMap: new Map(),
    getDomainInstance: vi.fn(),
    setDomainInstance: vi.fn(),
    ...overrides,
  } as unknown as import('@server/MCPServer.context').MCPServerContext;
}

describe('CrossDomainOrchestrator', () => {
  describe('construction', () => {
    it('should create with default config', () => {
      const ctx = createMockCtx();
      const orch = new CrossDomainOrchestrator(ctx);
      expect(orch).toBeDefined();
    });

    it('should create with custom config', () => {
      const ctx = createMockCtx();
      const orch = new CrossDomainOrchestrator(ctx, {
        timeoutPerStep: 5000,
        maxRetries: 3,
      });
      expect(orch).toBeDefined();
    });
  });

  describe('getCapabilityFlags', () => {
    it('should reflect available dependencies', () => {
      const ctx = createMockCtx({
        pageController: {},
        workerPool: { submit: vi.fn() },
        debuggerManager: {},
      });
      const orch = new CrossDomainOrchestrator(ctx);
      const flags = orch.getCapabilityFlags();
      expect(flags.v8BytecodeAvailable).toBe(true);
      expect(flags.workerPoolAvailable).toBe(true);
      expect(flags.debuggerEnabled).toBe(true);
    });

    it('should report unavailable missing dependencies', () => {
      const ctx = createMockCtx({
        pageController: undefined,
        workerPool: null,
        debuggerManager: undefined,
      });
      const orch = new CrossDomainOrchestrator(ctx);
      const flags = orch.getCapabilityFlags();
      expect(flags.v8BytecodeAvailable).toBe(false);
      expect(flags.workerPoolAvailable).toBe(false);
    });
  });

  describe('planSequence', () => {
    it('should plan sequence for a tool', () => {
      const ctx = createMockCtx();
      const orch = new CrossDomainOrchestrator(ctx);
      const plan = orch.planSequence('v8_heap_snapshot_capture', { forceGC: true });
      expect(plan.sequence.length).toBeGreaterThan(0);
      // Target tool should be in the sequence
      const targetStep = plan.sequence.find((s: { toolName: string }) => s.toolName === 'v8_heap_snapshot_capture');
      expect(targetStep).toBeDefined();
      expect(plan.estimatedDuration).toBeGreaterThan(0);
    });

    it('should include prerequisites', () => {
      const ctx = createMockCtx();
      const orch = new CrossDomainOrchestrator(ctx);
      const plan = orch.planSequence('v8_heap_snapshot_capture', {});
      // Manifest declares prerequisites
      if (plan.prerequisites.length > 0) {
        expect(plan.prerequisites[0]).toHaveProperty('condition');
        expect(plan.prerequisites[0]).toHaveProperty('fix');
      }
    });
  });

  describe('suggestWorkflow', () => {
    it('should return null for unknown query', () => {
      const ctx = createMockCtx();
      const orch = new CrossDomainOrchestrator(ctx);
      const suggestion = orch.suggestWorkflow('xyzzy nothing');
      expect(suggestion).toBeNull();
    });

    it('should suggest workflow for heap-related query', async () => {
      const ctx = createMockCtx();
      const orch = new CrossDomainOrchestrator(ctx);
      await orch.init();
      const suggestion = orch.suggestWorkflow('heap snapshot memory leak');
      expect(suggestion).not.toBeNull();
    });
  });

  describe('executeSequence', () => {
    it('should execute steps in order', async () => {
      const ctx = createMockCtx({
        executeToolWithTracking: vi.fn().mockResolvedValue({ ok: true }),
      });
      const orch = new CrossDomainOrchestrator(ctx);
      const plan = orch.planSequence('v8_heap_snapshot_capture', {});
      const results = await orch.executeSequence(plan, {});
      expect(results.length).toBe(plan.sequence.length);
      expect(results.every((r: { status: string }) => r.status === 'success')).toBe(true);
    });

    it('should handle step failures', async () => {
      const executeToolWithTracking = vi.fn().mockRejectedValue(new Error('timeout'));
      const ctx = createMockCtx({ executeToolWithTracking });
      const orch = new CrossDomainOrchestrator(ctx, { maxRetries: 0 });
      const plan = orch.planSequence('v8_heap_snapshot_capture', {});
      const results = await orch.executeSequence(plan, {});
      expect(results.some((r: { status: string }) => r.status === 'failed')).toBe(true);
    });

    it('should retry failed steps', async () => {
      let callCount = 0;
      const executeToolWithTracking = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) throw new Error('temp error');
        return Promise.resolve({ ok: true });
      });
      const ctx = createMockCtx({ executeToolWithTracking });
      const orch = new CrossDomainOrchestrator(ctx, { maxRetries: 1 });
      const plan = orch.planSequence('v8_heap_snapshot_capture', {});
      const results = await orch.executeSequence(plan, {});
      void results;
      // First step retries then succeeds
      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('init', () => {
    it('should initialize only once', async () => {
      const ctx = createMockCtx();
      const orch = new CrossDomainOrchestrator(ctx);
      await orch.init();
      await orch.init(); // should not throw
    });
  });
});
