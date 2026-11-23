import { describe, expect, it } from 'vitest';
import { WorkflowRunStore } from '@server/workflows/WorkflowRunStore';
import type { ExecuteWorkflowResult, WorkflowSpan } from '@server/workflows/WorkflowEngine.types';

function makeResult(
  workflowId: string,
  runId: string,
  stepKeys: string[],
  stepResults?: Record<string, unknown>,
  spans: WorkflowSpan[] = [],
): ExecuteWorkflowResult {
  return {
    workflowId,
    displayName: workflowId,
    runId,
    profile: 'workflow',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    result: { ok: true },
    stepResults:
      stepResults ?? Object.fromEntries(stepKeys.map((key) => [key, { payload: `output-${key}` }])),
    metrics: [],
    spans,
  };
}

describe('WorkflowRunStore bounded retention', () => {
  describe('runs cap', () => {
    it('caps retained runs and evicts the oldest entry', () => {
      const store = new WorkflowRunStore(3);
      for (let i = 0; i < 5; i += 1) {
        store.recordSuccess(makeResult('wf', `run-${i}`, ['s1']));
      }
      expect(store.listRuns()).toHaveLength(3);
      expect(store.getRun('run-0')).toBeUndefined();
      expect(store.getRun('run-1')).toBeUndefined();
      expect(store.getRun('run-2')).toBeDefined();
      expect(store.getRun('run-4')).toBeDefined();
    });

    it('also evicts the oldest entry on error runs', () => {
      const store = new WorkflowRunStore(2);
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', new Error('boom'));
      store.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', new Error('boom'));
      store.recordError('wf', 'run-2', '2026-01-01T00:00:00.000Z', new Error('boom'));
      expect(store.listRuns()).toHaveLength(2);
      expect(store.getRun('run-0')).toBeUndefined();
      expect(store.getRun('run-2')).toBeDefined();
    });
  });

  describe('listRuns pagination', () => {
    it('supports limit and offset with defaults that keep old behavior', () => {
      const store = new WorkflowRunStore(10);
      for (let i = 0; i < 5; i += 1) {
        store.recordSuccess(makeResult('wf', `run-${i}`, ['s1']));
      }
      expect(store.listRuns()).toHaveLength(5);
      expect(store.listRuns(undefined, { limit: 2 })).toHaveLength(2);
      const page = store.listRuns(undefined, { offset: 1, limit: 2 });
      expect(page.map((entry) => entry.runId)).toEqual(['run-1', 'run-2']);
    });
  });

  describe('lastSuccess summary', () => {
    it('retains only step-result keys, not the raw step outputs', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['alpha', 'beta']));
      const last = store.getLastSuccess('wf');
      expect(last).toBeDefined();
      expect(last!.status).toBe('success');
      expect(last!.stepResultKeys).toEqual(['alpha', 'beta']);
      expect(last).not.toHaveProperty('stepResults');
    });
  });
});

describe('WorkflowRunStore structured run history', () => {
  describe('recordSuccess outcomes', () => {
    it('derives per-step outcomes from step results', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(
        makeResult('wf', 'run-0', [], {
          s1: { payload: 'ok' },
          s2: { payload: 'ok' },
        }),
      );
      const entry = store.getRun('run-0');
      expect(entry!.stepOutcomes).toEqual([
        { stepId: 's1', status: 'success' },
        { stepId: 's2', status: 'success' },
      ]);
    });

    it('marks failed parallel steps as errored with a snippet', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(
        makeResult('wf', 'run-0', [], {
          s1: { payload: 'ok' },
          s2: { success: false, error: 'tool exploded' },
        }),
      );
      const entry = store.getRun('run-0');
      expect(entry!.stepOutcomes).toContainEqual({
        stepId: 's2',
        status: 'error',
        errorSnippet: 'tool exploded',
      });
    });

    it('keeps stepResultKeys but excludes engine-internal keys from outcomes', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(
        makeResult('wf', 'run-0', [], {
          s1: { payload: 'ok' },
          __evidenceSnapshot: { nodes: [] },
        }),
      );
      const entry = store.getRun('run-0');
      expect(entry!.stepResultKeys).toContain('__evidenceSnapshot');
      expect(entry!.stepOutcomes?.map((o) => o.stepId)).toEqual(['s1']);
    });

    it('derives per-step durations from start/finish spans', () => {
      const store = new WorkflowRunStore(10);
      const spans: WorkflowSpan[] = [
        { name: 'workflow.node.start', attrs: { nodeId: 's1' }, at: '2026-01-01T00:00:00.000Z' },
        { name: 'workflow.node.finish', attrs: { nodeId: 's1' }, at: '2026-01-01T00:00:00.050Z' },
        { name: 'workflow.node.start', attrs: { nodeId: 's2' }, at: '2026-01-01T00:00:00.000Z' },
      ];
      store.recordSuccess(makeResult('wf', 'run-0', [], { s1: {}, s2: {} }, spans));
      const entry = store.getRun('run-0');
      expect(entry!.stepOutcomes).toEqual([
        { stepId: 's1', status: 'success', durationMs: 50 },
        { stepId: 's2', status: 'success' },
      ]);
    });

    it('caps the number of outcomes per run', () => {
      const store = new WorkflowRunStore(10);
      const stepResults: Record<string, unknown> = {};
      for (let i = 0; i < 150; i += 1) {
        stepResults[`s${i}`] = { payload: 'ok' };
      }
      store.recordSuccess(makeResult('wf', 'run-0', [], stepResults));
      const entry = store.getRun('run-0');
      expect(entry!.stepOutcomes).toHaveLength(100);
    });
  });

  describe('recordError outcomes', () => {
    it('records the error message', () => {
      const store = new WorkflowRunStore(10);
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', new Error('boom'));
      const entry = store.getRun('run-0');
      expect(entry!.status).toBe('error');
      expect(entry!.errorMessage).toBe('boom');
    });

    it('stringifies non-Error errors', () => {
      const store = new WorkflowRunStore(10);
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', 'flat failure');
      const entry = store.getRun('run-0');
      expect(entry!.errorMessage).toBe('flat failure');
    });

    it('does not throw for undefined or symbol errors', () => {
      const store = new WorkflowRunStore(10);
      expect(() =>
        store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', undefined),
      ).not.toThrow();
      expect(() =>
        store.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', Symbol('boom')),
      ).not.toThrow();
      expect(store.getRun('run-0')!.errorMessage).toBe('undefined');
      expect(store.getRun('run-1')!.errorMessage).toBe('Symbol(boom)');
    });

    it('truncates long error messages', () => {
      const store = new WorkflowRunStore(10);
      const long = 'x'.repeat(1000);
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', new Error(long));
      const entry = store.getRun('run-0');
      expect(entry!.errorMessage).toHaveLength(500);
    });

    it('accepts optional step outcomes', () => {
      const store = new WorkflowRunStore(10);
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', new Error('boom'), [
        { stepId: 's1', status: 'success', durationMs: 10 },
        { stepId: 's2', status: 'error', errorSnippet: 'failed mid-run' },
      ]);
      const entry = store.getRun('run-0');
      expect(entry!.stepOutcomes).toEqual([
        { stepId: 's1', status: 'success', durationMs: 10 },
        { stepId: 's2', status: 'error', errorSnippet: 'failed mid-run' },
      ]);
    });

    it('omits stepOutcomes when not provided (backwards compatible)', () => {
      const store = new WorkflowRunStore(10);
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', new Error('boom'));
      const entry = store.getRun('run-0');
      expect(entry!.stepOutcomes).toBeUndefined();
    });

    it('caps and truncates passed step outcomes', () => {
      const store = new WorkflowRunStore(10);
      const outcomes = Array.from({ length: 150 }, (_, i) => ({
        stepId: `s${i}`,
        status: 'error' as const,
        errorSnippet: 'y'.repeat(400),
      }));
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', new Error('boom'), outcomes);
      const entry = store.getRun('run-0');
      expect(entry!.stepOutcomes).toHaveLength(100);
      expect(entry!.stepOutcomes![0]!.errorSnippet).toHaveLength(200);
    });

    it('retains structured fields after eviction', () => {
      const store = new WorkflowRunStore(1);
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', new Error('first'), [
        { stepId: 's1', status: 'error', errorSnippet: 'nope' },
      ]);
      store.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', new Error('second'), [
        { stepId: 's1', status: 'success' },
      ]);
      expect(store.getRun('run-0')).toBeUndefined();
      const entry = store.getRun('run-1');
      expect(entry!.errorMessage).toBe('second');
      expect(entry!.stepOutcomes).toEqual([{ stepId: 's1', status: 'success' }]);
    });
  });

  describe('getHistory', () => {
    it('returns runs newest first, including failures', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['s1']));
      store.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', new Error('boom'));
      store.recordSuccess(makeResult('wf', 'run-2', ['s1']));

      const history = store.getHistory('wf');
      // run-1 finished "now" (later than the fixed 2026 timestamps of the two
      // successes), so it is newest; run-2 was recorded after run-0 and both
      // share their finishedAt, so run-2 wins that tie.
      expect(history.map((e) => e.runId)).toEqual(['run-1', 'run-2', 'run-0']);
      expect(history.map((e) => e.status)).toEqual(['error', 'success', 'success']);
    });

    it('isolates workflows and honors the limit', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf-a', 'run-0', ['s1']));
      store.recordSuccess(makeResult('wf-a', 'run-1', ['s1']));
      store.recordSuccess(makeResult('wf-b', 'run-2', ['s1']));
      expect(store.getHistory('wf-a').map((e) => e.runId)).toEqual(['run-1', 'run-0']);
      expect(store.getHistory('wf-a', 1).map((e) => e.runId)).toEqual(['run-1']);
      expect(store.getHistory('wf-missing')).toEqual([]);
    });
  });

  describe('getFailureRate', () => {
    it('computes failures over the sliding window', () => {
      const store = new WorkflowRunStore(20);
      for (let i = 0; i < 3; i += 1) {
        store.recordSuccess(makeResult('wf', `ok-${i}`, ['s1']));
      }
      for (let i = 0; i < 2; i += 1) {
        store.recordError('wf', `err-${i}`, '2026-01-01T00:00:00.000Z', new Error('boom'));
      }
      const rate = store.getFailureRate('wf');
      expect(rate).toEqual({ total: 5, failures: 2, rate: 0.4 });
    });

    it('only counts the most recent window runs', () => {
      const store = new WorkflowRunStore(20);
      for (let i = 0; i < 5; i += 1) {
        store.recordSuccess(makeResult('wf', `ok-${i}`, ['s1']));
      }
      // Two failures recorded last — they are the newest runs.
      store.recordError('wf', 'err-0', '2026-01-01T00:00:00.000Z', new Error('boom'));
      store.recordError('wf', 'err-1', '2026-01-01T00:00:00.000Z', new Error('boom'));
      const rate = store.getFailureRate('wf', 3);
      expect(rate).toEqual({ total: 3, failures: 2, rate: 2 / 3 });
    });

    it('reports zeros for an unknown workflow', () => {
      const store = new WorkflowRunStore(10);
      expect(store.getFailureRate('wf-missing')).toEqual({ total: 0, failures: 0, rate: 0 });
    });
  });

  describe('getLastFailure', () => {
    it('returns the most recent failure with its message', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['s1']));
      store.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', new Error('first'));
      store.recordError('wf', 'run-2', '2026-01-01T00:00:00.000Z', new Error('second'));
      const last = store.getLastFailure('wf');
      expect(last!.runId).toBe('run-2');
      expect(last!.errorMessage).toBe('second');
    });

    it('is undefined when the workflow only succeeded', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['s1']));
      expect(store.getLastFailure('wf')).toBeUndefined();
    });
  });

  describe('getStepHistory', () => {
    it('tracks a single step across runs, newest first', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', [], { s1: {}, s2: {} }));
      store.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', new Error('boom'), [
        { stepId: 's1', status: 'error', errorSnippet: 'bad', durationMs: 7 },
      ]);
      const history = store.getStepHistory('wf', 's1');
      expect(history).toEqual([
        { runId: 'run-1', status: 'error', durationMs: 7, errorSnippet: 'bad' },
        { runId: 'run-0', status: 'success' },
      ]);
      // s2 has no outcome in run-1, so only run-0 contributes.
      expect(store.getStepHistory('wf', 's2')).toEqual([{ runId: 'run-0', status: 'success' }]);
    });

    it('honors the limit', () => {
      const store = new WorkflowRunStore(20);
      for (let i = 0; i < 5; i += 1) {
        store.recordSuccess(makeResult('wf', `run-${i}`, [], { s1: {} }));
      }
      expect(store.getStepHistory('wf', 's1', 2)).toHaveLength(2);
      expect(store.getStepHistory('wf', 's1', 2)![0]!.runId).toBe('run-4');
    });

    it('reports an unknown step as empty', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['s1']));
      expect(store.getStepHistory('wf', 'nope')).toEqual([]);
    });
  });

  describe('snapshot persistence', () => {
    it('round-trips entries, lastSuccess, and structured fields', () => {
      const source = new WorkflowRunStore(10);
      source.recordSuccess(makeResult('wf', 'run-0', [], { s1: {} }));
      source.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', new Error('boom'), [
        { stepId: 's1', status: 'error', errorSnippet: 'bad' },
      ]);

      const target = new WorkflowRunStore(10);
      target.restoreSnapshot(source.exportSnapshot());

      expect(target.getRun('run-0')!.stepOutcomes).toEqual([{ stepId: 's1', status: 'success' }]);
      expect(target.getRun('run-1')!.errorMessage).toBe('boom');
      expect(target.getRun('run-1')!.stepOutcomes).toEqual([
        { stepId: 's1', status: 'error', errorSnippet: 'bad' },
      ]);
      // lastSuccess survives: run-0 is the latest successful run of wf.
      expect(target.getLastSuccess('wf')!.runId).toBe('run-0');
    });

    it('evicts malformed step outcomes instead of aborting the restore', () => {
      const source = new WorkflowRunStore(10);
      source.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', new Error('boom'), [
        { stepId: 's1', status: 'success' },
      ]);
      const snapshot = source.exportSnapshot();
      (snapshot.runs[0] as { stepOutcomes?: unknown }).stepOutcomes = [
        null,
        { stepId: 's1', status: 'success' },
      ];

      const target = new WorkflowRunStore(10);
      expect(() => target.restoreSnapshot(snapshot)).not.toThrow();
      expect(target.getRun('run-1')!.stepOutcomes).toEqual([{ stepId: 's1', status: 'success' }]);
    });

    it('marks itself dirty on mutation and clean after markPersisted', () => {
      const store = new WorkflowRunStore(10);
      expect(store.isPersistDirty()).toBe(false);
      store.recordSuccess(makeResult('wf', 'run-0', ['s1']));
      expect(store.isPersistDirty()).toBe(true);
      store.markPersisted();
      expect(store.isPersistDirty()).toBe(false);
    });

    it('marks itself clean after restore', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['s1']));
      expect(store.isPersistDirty()).toBe(true);
      store.restoreSnapshot({ schemaVersion: 1, savedAt: '2026-01-01T00:00:00.000Z', runs: [] });
      expect(store.isPersistDirty()).toBe(false);
      expect(store.listRuns()).toHaveLength(0);
    });

    it('trims an oversized restored snapshot back to the cap', () => {
      const source = new WorkflowRunStore(1000);
      for (let i = 0; i < 10; i += 1) {
        source.recordSuccess(makeResult('wf', `run-${i}`, ['s1']));
      }
      const target = new WorkflowRunStore(3);
      const summary = target.restoreSnapshot(source.exportSnapshot());
      expect(target.listRuns()).toHaveLength(3);
      // Oldest runs are the front of the insertion-ordered map.
      expect(target.getRun('run-0')).toBeUndefined();
      expect(target.getRun('run-9')).toBeDefined();
      expect(summary).toEqual({ evictedHistoryKeys: 7 });
    });

    it('ignores malformed payloads without throwing', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['s1']));
      const before = store.exportSnapshot();

      expect(() => store.restoreSnapshot(null)).not.toThrow();
      expect(() => store.restoreSnapshot({})).not.toThrow();
      expect(() => store.restoreSnapshot({ schemaVersion: 99 })).not.toThrow();
      expect(() => store.restoreSnapshot('string')).not.toThrow();
      expect(() => store.restoreSnapshot(42)).not.toThrow();

      // A malformed run entry is dropped, valid ones are kept.
      const malformed = {
        schemaVersion: 1,
        savedAt: '2026-01-01T00:00:00.000Z',
        runs: [
          { runId: 'bad', workflowId: 123, status: 'nope' },
          {
            runId: 'run-1',
            workflowId: 'wf',
            startedAt: '2026-01-01T00:00:00.000Z',
            finishedAt: '2026-01-01T00:00:01.000Z',
            durationMs: 1000,
            status: 'success',
            stepResultKeys: ['s1'],
          },
        ],
      };
      const summary = store.restoreSnapshot(malformed);
      expect(store.getRun('bad')).toBeUndefined();
      expect(store.getRun('run-1')).toBeDefined();
      expect(summary).toEqual({ evictedHistoryKeys: 1 });
      expect(before.runs).toHaveLength(1);
    });

    it('exports a versioned, self-describing snapshot', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['s1']));
      const snapshot = store.exportSnapshot();
      expect(snapshot.schemaVersion).toBe(1);
      expect(typeof snapshot.savedAt).toBe('string');
      expect(snapshot.runs).toHaveLength(1);
      expect(snapshot.lastSuccessByWorkflow).toEqual({ wf: 'run-0' });
    });
  });
});
