import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkflowDataBus,
  collectSuccessStats,
  parseToolPayload,
  resolveInputFrom,
  resolveInputValues,
  responseIndicatesFailure,
} from '@server/workflows/WorkflowDataBus';
import { evaluatePredicate } from '@server/workflows/WorkflowPredicates';
import {
  collectUnsatisfiedPrerequisites,
  getEvidenceState,
} from '@server/workflows/WorkflowPreflight';
import {
  branchStep,
  fallbackStep,
  parallelStep,
  sequenceStep,
  toolStep,
  type BranchNode,
  type WorkflowExecutionContext,
  type WorkflowNode,
} from '@server/workflows/WorkflowContract';
import type { InternalExecutionContext } from '@server/workflows/WorkflowEngine.types';

const preflightMocks = vi.hoisted(() => ({
  getEffectivePrerequisites: vi.fn(),
}));

vi.mock('@server/ToolRouter.policy', () => ({
  getEffectivePrerequisites: preflightMocks.getEffectivePrerequisites,
}));

function textResponse(payload: unknown, options?: { isError?: boolean }) {
  return {
    ...(options?.isError ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

function createExecutionContext(
  stepResults: Map<string, unknown> = new Map(),
): InternalExecutionContext<WorkflowDataBus> {
  const workflowContext: WorkflowExecutionContext = {
    workflowRunId: 'run-123',
    profile: 'workflow',
    stepResults,
    invokeTool: vi.fn(),
    emitSpan: vi.fn(),
    emitMetric: vi.fn(),
    getConfig<T = unknown>(_path: string, fallback?: T): T {
      return fallback as T;
    },
  };

  return {
    ...workflowContext,
    stepResults,
    dataBus: new WorkflowDataBus(),
  };
}

describe('workflows helpers coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preflightMocks.getEffectivePrerequisites.mockReset();
  });

  describe('WorkflowDataBus', () => {
    it('parses tool payloads and reports failure envelopes', () => {
      expect(parseToolPayload(null)).toBeUndefined();
      expect(parseToolPayload({ content: [{ type: 'text', text: '1' }] })).toBeUndefined();
      expect(parseToolPayload({ content: [{ type: 'text', text: '{bad json' }] })).toBeUndefined();
      expect(parseToolPayload({ content: [{ type: 'image', text: '{"x":1}' }] })).toBeUndefined();
      expect(parseToolPayload(textResponse({ success: true, nested: { value: 1 } }))).toEqual({
        success: true,
        nested: { value: 1 },
      });

      expect(responseIndicatesFailure(null)).toBeUndefined();
      expect(responseIndicatesFailure(textResponse({ ok: true }, { isError: true }))).toBe(
        'Tool returned MCP error response',
      );
      expect(responseIndicatesFailure(textResponse({ success: false, error: 'boom' }))).toBe(
        'boom',
      );
      expect(responseIndicatesFailure(textResponse({ success: false, error: { code: 500 } }))).toBe(
        'Tool reported success=false',
      );
      expect(responseIndicatesFailure(textResponse({ success: true }))).toBeUndefined();
    });

    it('resolves nested values from plain objects and tool responses', () => {
      const dataBus = new WorkflowDataBus();
      dataBus.set('plain', { nested: [{ value: 'alpha' }] });
      dataBus.set('response', textResponse({ nested: { values: ['zero', 'one'] }, list: ['x'] }));
      dataBus.set('scalar', 7);

      expect(dataBus.get('scalar')).toBe(7);
      expect(dataBus.getValueAtPath('plain', 'nested.0.value')).toBe('alpha');
      expect(dataBus.getValueAtPath('response', 'nested.values.1')).toBe('one');
      expect(dataBus.getValueAtPath('response', 'list.0.extra')).toBeUndefined();
      expect(dataBus.getValueAtPath('scalar', 'ignored.path')).toBe(7);

      expect(dataBus.resolve('literal-value')).toBe('literal-value');
      expect(dataBus.resolve('${plain}')).toEqual({ nested: [{ value: 'alpha' }] });
      expect(dataBus.resolve('${response.nested.values.0}')).toBe('zero');
      expect(dataBus.resolve('${missing.value}')).toBeUndefined();
    });

    it('collects success stats across arrays, keyed parallel results, and error payloads', () => {
      expect(collectSuccessStats('noop')).toEqual({ success: 0, failure: 0 });
      expect(
        collectSuccessStats([
          textResponse({ success: true }),
          textResponse({ success: false, error: 'boom' }),
        ]),
      ).toEqual({ success: 1, failure: 1 });
      expect(
        collectSuccessStats({
          __order: ['good', 'bad'],
          good: textResponse({ success: true }),
          bad: { error: 'plain failure' },
        }),
      ).toEqual({ success: 1, failure: 1 });
      expect(collectSuccessStats({ error: 'plain failure' })).toEqual({ success: 0, failure: 1 });
      expect(collectSuccessStats({ note: 'neutral' })).toEqual({ success: 0, failure: 0 });
    });

    it('resolves input mappings recursively across nested values', () => {
      const dataBus = new WorkflowDataBus();
      dataBus.set('step', textResponse({ token: 'abc', items: ['first', 'second'] }));
      dataBus.set('direct', { count: 2 });

      expect(
        resolveInputFrom({ token: 'step.token', literal: '${direct.count}' }, dataBus),
      ).toEqual({
        token: 'abc',
        literal: 2,
      });

      expect(resolveInputValues(undefined, dataBus)).toEqual({});
      expect(
        resolveInputValues(
          {
            token: '${step.token}',
            literal: 5,
            nested: {
              list: ['${step.items.1}', true],
              count: '${direct.count}',
            },
          },
          dataBus,
        ),
      ).toEqual({
        token: 'abc',
        literal: 5,
        nested: {
          list: ['second', true],
          count: 2,
        },
      });
    });
  });

  describe('WorkflowPredicates', () => {
    it('supports predicate functions and built-in constant predicates', async () => {
      const ctx = createExecutionContext();
      const predicateFn = vi.fn(async () => true);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'predicate-fn',
            predicateId: 'always_false',
            predicateFn,
            whenTrue: toolStep('t1', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(true);
      expect(predicateFn).toHaveBeenCalledOnce();

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'always-true',
            predicateId: 'always_true',
            whenTrue: toolStep('t2', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(true);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'always-false',
            predicateId: 'always_false',
            whenTrue: toolStep('t3', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('evaluates failure-rate and success-rate predicates from step results', async () => {
      const failingCtx = createExecutionContext(
        new Map([
          ['ok', textResponse({ success: true })],
          ['bad', textResponse({ success: false, error: 'boom' })],
        ]),
      );

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'any-failed',
            predicateId: 'any_step_failed',
            whenTrue: toolStep('t4', 'tool.alpha'),
          },
          failingCtx,
        ),
      ).toBe(true);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'success-rate-50',
            predicateId: 'success_rate_gte_50',
            whenTrue: toolStep('t5', 'tool.alpha'),
          },
          failingCtx,
        ),
      ).toBe(true);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'success-rate-80',
            predicateId: 'success_rate_gte_80',
            whenTrue: toolStep('t6', 'tool.alpha'),
          },
          failingCtx,
        ),
      ).toBe(false);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'success-rate-empty',
            predicateId: 'success_rate_gte_50',
            whenTrue: toolStep('t7', 'tool.alpha'),
          },
          createExecutionContext(),
        ),
      ).toBe(false);
    });

    it('supports variable equality, contains, and regex predicates', async () => {
      const stepResults = new Map<string, unknown>([
        ['ready', 'yes'],
        [
          'fetch',
          textResponse({
            name: 'alpha',
            items: ['zero', 'one'],
            tags: ['one', 'two'],
          }),
        ],
      ]);
      const ctx = createExecutionContext(stepResults);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'equals',
            predicateId: 'variable_equals_ready_yes',
            whenTrue: toolStep('t8', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(true);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'contains-array-index',
            predicateId: 'variable_contains_fetch.items.1_ne',
            whenTrue: toolStep('t9', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(true);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'contains-array',
            predicateId: 'variable_contains_fetch.tags_two',
            whenTrue: toolStep('t10', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(true);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'contains-missing',
            predicateId: 'variable_contains_fetch.missing_two',
            whenTrue: toolStep('t11', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(false);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'matches',
            predicateId: 'variable_matches_fetch.name_^alp',
            whenTrue: toolStep('t12', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(true);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'matches-invalid',
            predicateId: 'variable_matches_fetch.name_[',
            whenTrue: toolStep('t13', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(false);

      expect(
        await evaluatePredicate(
          {
            kind: 'branch',
            id: 'matches-non-string',
            predicateId: 'variable_matches_fetch.items_^one$',
            whenTrue: toolStep('t14', 'tool.alpha'),
          },
          ctx,
        ),
      ).toBe(false);
    });

    it('throws for unknown predicate ids', async () => {
      await expect(
        evaluatePredicate(
          {
            kind: 'branch',
            id: 'unknown',
            predicateId: 'not_supported',
            whenTrue: toolStep('t15', 'tool.alpha'),
          },
          createExecutionContext(),
        ),
      ).rejects.toThrow('Unknown workflow predicateId "not_supported"');
    });
  });

  describe('WorkflowPreflight', () => {
    it('collects unsatisfied prerequisites across nested workflow node kinds', () => {
      preflightMocks.getEffectivePrerequisites.mockReturnValue({
        tool_alpha: [
          {
            condition: 'alpha condition',
            check: () => false,
            fix: 'alpha fix',
          },
        ],
        tool_beta: [
          {
            condition: 'beta condition',
            check: () => true,
            fix: 'beta fix',
          },
        ],
        tool_gamma: [
          {
            condition: 'gamma condition',
            check: () => false,
            fix: 'gamma fix',
          },
        ],
        tool_delta: [
          {
            condition: 'delta condition',
            check: () => false,
            fix: 'delta fix',
          },
        ],
        tool_epsilon: [
          {
            condition: 'epsilon condition',
            check: () => false,
            fix: 'epsilon fix',
          },
        ],
      });

      const graph = sequenceStep('root', (sequence) => {
        sequence.step(toolStep('alpha-node', 'tool_alpha'));
        sequence.step(
          parallelStep('parallel-node', (parallel) => {
            parallel.step(toolStep('beta-node', 'tool_beta'));
            parallel.step(
              branchStep('branch-node', 'always_true', (branch) => {
                branch.whenTrue(toolStep('gamma-node', 'tool_gamma'));
                branch.whenFalse(toolStep('delta-node', 'tool_delta'));
              }),
            );
            parallel.step(
              fallbackStep('fallback-node', (fallback) => {
                fallback.primary(toolStep('epsilon-node', 'tool_epsilon'));
                fallback.fallback(toolStep('zeta-node', 'tool_zeta'));
              }),
            );
          }),
        );
      });

      expect(
        collectUnsatisfiedPrerequisites(graph, {
          hasActivePage: false,
          networkEnabled: false,
          capturedRequestCount: 0,
        }),
      ).toEqual([
        {
          nodeId: 'alpha-node',
          toolName: 'tool_alpha',
          condition: 'alpha condition',
          fix: 'alpha fix',
        },
        {
          nodeId: 'gamma-node',
          toolName: 'tool_gamma',
          condition: 'gamma condition',
          fix: 'gamma fix',
        },
        {
          nodeId: 'delta-node',
          toolName: 'tool_delta',
          condition: 'delta condition',
          fix: 'delta fix',
        },
        {
          nodeId: 'epsilon-node',
          toolName: 'tool_epsilon',
          condition: 'epsilon condition',
          fix: 'epsilon fix',
        },
      ]);
    });

    it('handles branch nodes without whenFalse and unknown node kinds', () => {
      preflightMocks.getEffectivePrerequisites.mockReturnValue({
        tool_single: [
          {
            condition: 'single condition',
            check: () => false,
            fix: 'single fix',
          },
        ],
      });

      const branchOnly = {
        kind: 'branch',
        id: 'branch-only',
        predicateId: 'always_true',
        whenTrue: toolStep('single-node', 'tool_single'),
      } satisfies BranchNode;

      expect(
        collectUnsatisfiedPrerequisites(branchOnly, {
          hasActivePage: true,
          networkEnabled: false,
          capturedRequestCount: 1,
        }),
      ).toEqual([
        {
          nodeId: 'single-node',
          toolName: 'tool_single',
          condition: 'single condition',
          fix: 'single fix',
        },
      ]);

      expect(
        collectUnsatisfiedPrerequisites(
          { kind: 'mystery', id: 'unknown' } as unknown as WorkflowNode,
          {
            hasActivePage: false,
            networkEnabled: false,
            capturedRequestCount: 0,
          },
        ),
      ).toEqual([]);
    });

    it('reports evidence graph state for present, missing, and throwing contexts', () => {
      expect(
        getEvidenceState({
          getDomainInstance: vi.fn(() => ({ nodeCount: 3, edgeCount: 5 })),
        } as never),
      ).toEqual({
        hasGraph: true,
        nodeCount: 3,
        edgeCount: 5,
      });

      expect(
        getEvidenceState({
          getDomainInstance: vi.fn(() => undefined),
        } as never),
      ).toEqual({
        hasGraph: false,
        nodeCount: 0,
        edgeCount: 0,
      });

      expect(
        getEvidenceState({
          getDomainInstance: vi.fn(() => {
            throw new Error('lookup failed');
          }),
        } as never),
      ).toEqual({
        hasGraph: false,
        nodeCount: 0,
        edgeCount: 0,
      });
    });
  });
});
