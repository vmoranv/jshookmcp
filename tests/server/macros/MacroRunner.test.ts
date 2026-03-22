import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MacroRunner } from '@server/macros/MacroRunner';
import type { MacroDefinition, MacroResult } from '@server/macros/types';

// Mock WorkflowEngine
vi.mock('@server/workflows/WorkflowEngine', () => ({
  executeExtensionWorkflow: vi.fn(),
}));

import { executeExtensionWorkflow } from '@server/workflows/WorkflowEngine';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
const mockCtx = {} as any;

function makeDef(overrides?: Partial<MacroDefinition>): MacroDefinition {
  return {
    id: 'test_macro',
    displayName: 'Test Macro',
    description: 'A test macro',
    tags: ['test'],
    timeoutMs: 5000,
    steps: [
      { id: 'step_a', toolName: 'tool_a' },
      { id: 'step_b', toolName: 'tool_b' },
    ],
    ...overrides,
  };
}

describe('MacroRunner', () => {
  let runner: MacroRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new MacroRunner(mockCtx);
  });

  it('buildWorkflowFromDefinition creates valid WorkflowContract', () => {
    const def = makeDef();
    const wf = runner.buildWorkflowFromDefinition(def);
    expect(wf.id).toBe('test_macro');
    expect(wf.displayName).toBe('Test Macro');
    expect(wf.kind).toBe('workflow-contract');
    expect(wf.version).toBe(1);
    expect(wf.timeoutMs).toBe(5000);
    expect(wf.tags).toEqual(['test']);
  });

  it('execute() returns ok=true on success', async () => {
    const def = makeDef();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (executeExtensionWorkflow as any).mockResolvedValue({
      workflowId: 'test_macro',
      durationMs: 100,
      stepResults: { step_a: {}, step_b: {} },
      spans: [
        { name: 'workflow.node.start', attrs: { nodeId: 'step_a' }, at: '2026-01-01T00:00:00.000Z' },
        { name: 'workflow.node.finish', attrs: { nodeId: 'step_a' }, at: '2026-01-01T00:00:00.050Z' },
        { name: 'workflow.node.start', attrs: { nodeId: 'step_b' }, at: '2026-01-01T00:00:00.050Z' },
        { name: 'workflow.node.finish', attrs: { nodeId: 'step_b' }, at: '2026-01-01T00:00:00.100Z' },
      ],
    });

    const result = await runner.execute(def);
    expect(result.ok).toBe(true);
    expect(result.macroId).toBe('test_macro');
    expect(result.stepsCompleted).toBe(2);
    expect(result.totalSteps).toBe(2);
    expect(result.progress).toHaveLength(2);
  });

  it('execute() captures step progress with timing', async () => {
    const def = makeDef({ steps: [{ id: 'only_step', toolName: 'some_tool' }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (executeExtensionWorkflow as any).mockResolvedValue({
      durationMs: 42,
      stepResults: { only_step: { value: 'ok' } },
      spans: [
        { name: 'workflow.node.start', attrs: { nodeId: 'only_step' }, at: '2026-01-01T00:00:00.000Z' },
        { name: 'workflow.node.finish', attrs: { nodeId: 'only_step' }, at: '2026-01-01T00:00:00.042Z' },
      ],
    });

    const result = await runner.execute(def);
    expect(result.progress[0]!.step).toBe(1);
    expect(result.progress[0]!.totalSteps).toBe(1);
    expect(result.progress[0]!.stepName).toBe('only_step');
    expect(result.progress[0]!.status).toBe('complete');
    expect(result.progress[0]!.durationMs).toBe(42);
  });

  it('execute() returns partial results on step failure (atomic bailout)', async () => {
    const def = makeDef();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (executeExtensionWorkflow as any).mockRejectedValue(new Error('step_b failed: SyntaxError'));

    const result = await runner.execute(def);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('step_b failed: SyntaxError');
    expect(result.totalSteps).toBe(2);
    expect(result.progress).toHaveLength(2);
    expect(result.progress[0]!.status).toBe('failed');
  });

  it('execute() passes inputOverrides to executeExtensionWorkflow', async () => {
    const def = makeDef();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (executeExtensionWorkflow as any).mockResolvedValue({
      durationMs: 10,
      stepResults: {},
      spans: [],
    });

    const overrides = { step_a: { code: 'test()' } };
    await runner.execute(def, overrides);

    expect(executeExtensionWorkflow).toHaveBeenCalledWith(
      mockCtx,
      expect.anything(),
      expect.objectContaining({ nodeInputOverrides: overrides })
    );
  });

  it('execute() uses default timeout of 120s when not specified', () => {
    const def = makeDef({ timeoutMs: undefined });
    const wf = runner.buildWorkflowFromDefinition(def);
    expect(wf.timeoutMs).toBe(120_000);
  });

  it('formatProgressReport() generates inline progress text for success', () => {
    const result: MacroResult = {
      macroId: 'test',
      displayName: 'Test',
      ok: true,
      durationMs: 100,
      stepsCompleted: 2,
      totalSteps: 2,
      stepResults: {},
      progress: [
        { step: 1, totalSteps: 2, stepName: 'a', status: 'complete', durationMs: 40 },
        { step: 2, totalSteps: 2, stepName: 'b', status: 'complete', durationMs: 60 },
      ],
    };

    const report = runner.formatProgressReport(result);
    expect(report).toContain('[stage 1/2]');
    expect(report).toContain('[stage 2/2]');
    expect(report).toContain('✓ Macro complete (2/2 steps, 100ms)');
    expect(report).toContain('✓ a — complete (40ms)');
  });

  it('formatProgressReport() shows failure for failed macros', () => {
    const result: MacroResult = {
      macroId: 'test',
      displayName: 'Test',
      ok: false,
      durationMs: 50,
      stepsCompleted: 1,
      totalSteps: 3,
      stepResults: {},
      progress: [
        { step: 1, totalSteps: 3, stepName: 'a', status: 'complete', durationMs: 30 },
        { step: 2, totalSteps: 3, stepName: 'b', status: 'failed', error: 'timeout' },
      ],
      error: 'timeout at step b',
    };

    const report = runner.formatProgressReport(result);
    expect(report).toContain('✗ Macro failed at step 2/3');
    expect(report).toContain('✗ b — failed');
  });
});
