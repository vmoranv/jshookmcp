import { describe, expect, it } from 'vitest';
import {
  ToolCallTraceRecorder,
  classifyFailureCause,
} from '@server/observability/ToolCallTraceRecorder';
import { PrerequisiteError } from '@errors/PrerequisiteError';

describe('ToolCallTraceRecorder', () => {
  it('assigns monotonic seq and detects consecutive repeats per session', () => {
    const rec = new ToolCallTraceRecorder({ sessionId: 's1' });
    rec.recordToolCall({
      toolName: 'page_navigate',
      domain: 'browser',
      startedAt: 1,
      durationMs: 10,
      ok: true,
    });
    rec.recordToolCall({
      toolName: 'page_navigate',
      domain: 'browser',
      startedAt: 2,
      durationMs: 20,
      ok: true,
    });
    rec.recordToolCall({
      toolName: 'network_enable',
      domain: 'network',
      startedAt: 3,
      durationMs: 30,
      ok: true,
    });
    const trace = rec.snapshot('s1');
    expect(trace.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(trace.entries[0]!.repeated).toBe(false);
    expect(trace.entries[1]!.repeated).toBe(true);
    expect(trace.entries[2]!.repeated).toBe(false);
  });

  it('does not mark repeats across different sessions', () => {
    const rec = new ToolCallTraceRecorder({ sessionId: 's1' });
    rec.recordToolCall(
      { toolName: 'page_navigate', domain: 'browser', startedAt: 1, durationMs: 10, ok: true },
      's1',
    );
    rec.recordToolCall(
      { toolName: 'page_navigate', domain: 'browser', startedAt: 2, durationMs: 10, ok: true },
      's2',
    );
    expect(rec.snapshot('s1').entries[1]).toBeUndefined();
    expect(rec.snapshot('s2').entries[0]!.repeated).toBe(false);
  });

  it('evicts oldest entries past the cap and reports the loss honestly', () => {
    const rec = new ToolCallTraceRecorder({ sessionId: 's1', maxEntries: 3 });
    for (let i = 1; i <= 5; i++) {
      rec.recordToolCall({
        toolName: `t${i}`,
        domain: null,
        startedAt: i,
        durationMs: 1,
        ok: true,
      });
    }
    const trace = rec.snapshot('s1');
    expect(trace.entries.map((e) => e.toolName)).toEqual(['t3', 't4', 't5']);
    expect(trace.droppedEntries).toBe(2);
    expect(trace.totalRecorded).toBe(5);
  });

  it('serializes to JSONL with sessionId on every line', () => {
    const rec = new ToolCallTraceRecorder({ sessionId: 's1' });
    rec.recordToolCall({
      toolName: 'debugger_pause',
      domain: 'debugger',
      startedAt: 1000,
      durationMs: 5,
      ok: false,
      errorKind: 'handler',
    });
    const jsonl = rec.toJSONL('s1');
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed['sessionId']).toBe('s1');
    expect(parsed['toolName']).toBe('debugger_pause');
    expect(parsed['seq']).toBe(1);
  });

  it('returns empty trace for unknown session', () => {
    const rec = new ToolCallTraceRecorder();
    const trace = rec.snapshot('nope');
    expect(trace.entries).toEqual([]);
    expect(trace.totalRecorded).toBe(0);
  });

  it('reset clears only the targeted session', () => {
    const rec = new ToolCallTraceRecorder({ sessionId: 's1' });
    rec.recordToolCall(
      { toolName: 'a', domain: null, startedAt: 1, durationMs: 1, ok: true },
      's1',
    );
    rec.recordToolCall(
      { toolName: 'b', domain: null, startedAt: 2, durationMs: 1, ok: true },
      's2',
    );
    rec.reset('s1');
    expect(rec.snapshot('s1').entries).toEqual([]);
    expect(rec.snapshot('s2').entries).toHaveLength(1);
  });

  it('clamps non-positive maxEntries to one', () => {
    const rec = new ToolCallTraceRecorder({ sessionId: 's1', maxEntries: 0 });
    rec.recordToolCall({ toolName: 'a', domain: null, startedAt: 1, durationMs: 1, ok: true });
    rec.recordToolCall({ toolName: 'b', domain: null, startedAt: 2, durationMs: 1, ok: true });
    const trace = rec.snapshot('s1');
    expect(trace.entries).toHaveLength(1);
    expect(trace.droppedEntries).toBe(1);
  });
});

describe('classifyFailureCause', () => {
  const handlerStage = 'handler';
  const fineSig = {};

  it('keeps a stage-only kind when the failure legitimately has no structural signal', () => {
    expect(classifyFailureCause(handlerStage, fineSig)).toBe('handler');
    expect(classifyFailureCause('unknown', fineSig)).toBe('unknown');
  });

  it('returns undefined for a non-failure stage', () => {
    expect(classifyFailureCause(undefined, fineSig)).toBeUndefined();
  });

  it('lets gate and validation (pre-handler stages) pass through untouched', () => {
    expect(classifyFailureCause('gate', fineSig)).toBe('gate');
    expect(classifyFailureCause('validation', fineSig)).toBe('validation');
  });

  it('classifies a PrerequisiteError as prereq_missing regardless of its message', () => {
    const e = new PrerequisiteError('debugger unavailable');
    expect(classifyFailureCause(handlerStage, { error: e })).toBe('prereq_missing');
  });

  it('classifies a ToolError PREREQUISITE / NOT_FOUND / VALIDATION / CONNECTION', () => {
    const te = (code: string) => ({ code });
    expect(classifyFailureCause(handlerStage, { errorCode: 'PREREQUISITE' })).toBe(
      'prereq_missing',
    );
    // NOT_FOUND is a missing file, a missing tool OR a gone CDP target; the
    // code alone cannot tell them apart, so it keeps its own name.
    expect(classifyFailureCause(handlerStage, { error: te('NOT_FOUND') })).toBe('not_found');
    expect(classifyFailureCause(handlerStage, { error: te('VALIDATION') })).toBe('invalid_args');
    expect(classifyFailureCause(handlerStage, { errorCode: 'CONNECTION' })).toBe('network');
    expect(classifyFailureCause(handlerStage, { error: te('TIMEOUT') })).toBe('timeout');
  });

  it('classifies a wrapped ToolError by the code inside its cause chain', () => {
    // A handler that wraps a ToolError in its own error must still be
    // classified by the wrapped code — the outermost error carries none.
    const wrapped = new Error('collect failed', { cause: new PrerequisiteError('no browser') });
    expect(classifyFailureCause(handlerStage, { error: wrapped })).toBe('prereq_missing');

    const wrappedNotFound = new Error('lookup failed', {
      cause: { code: 'NOT_FOUND' } as unknown as Error,
    });
    expect(classifyFailureCause(handlerStage, { error: wrappedNotFound })).toBe('not_found');
  });

  it('prefers timeout over network for ETIMEDOUT / UND_ERR_CONNECT_TIMEOUT', () => {
    // These are socket timeouts, not "the network path is broken". Recording
    // them as `network` sent the wrong signal to whoever reads the profile.
    expect(classifyFailureCause(handlerStage, { errorCode: 'ETIMEDOUT' })).toBe('timeout');
    expect(classifyFailureCause(handlerStage, { error: { code: 'UND_ERR_CONNECT_TIMEOUT' } })).toBe(
      'timeout',
    );
    expect(
      classifyFailureCause(handlerStage, { platformError: 'connect ETIMEDOUT 10.0.0.1:443' }),
    ).toBe('timeout');
  });

  it('matches the "timed out" phrasing a plain Error uses', () => {
    // "timed out" does NOT contain the substring "timeout".
    expect(
      classifyFailureCause(handlerStage, {
        platformError: 'Operation timed out after 30000ms',
      }),
    ).toBe('timeout');
  });

  it('does not treat ERR_ABORTED as target loss', () => {
    // Chromium reports ERR_ABORTED for any canceled or superseded navigation,
    // including one the caller triggered against a perfectly alive target.
    expect(
      classifyFailureCause(handlerStage, { platformError: 'net::ERR_ABORTED at https://x.test/' }),
    ).toBe('network');
    expect(
      classifyFailureCause(handlerStage, {
        error: new Error('page.goto: net::ERR_ABORTED at https://x.test/'),
      }),
    ).toBe('network');
  });

  it('classifies Node platform network codes', () => {
    expect(classifyFailureCause(handlerStage, { error: { code: 'ENOTFOUND' } })).toBe('network');
    expect(classifyFailureCause(handlerStage, { error: { code: 'ECONNREFUSED' } })).toBe('network');
  });

  it('classifies Chromium network errors from the message', () => {
    const errNet = new Error('Navigating frame was detached: net::ERR_NAME_NOT_RESOLVED');
    expect(classifyFailureCause(handlerStage, { error: errNet })).toBe('network');
    const errGone = new Error('Protocol error (Target.getTargets): Session closed');
    expect(classifyFailureCause(handlerStage, { error: errGone })).toBe('handler');
  });

  it('walks the cause chain to find a nested network code', () => {
    const inner = new Error('inner', { cause: { code: 'ECONNREFUSED' } as unknown as Error });
    const tail = new Error('top', { cause: inner });
    expect(classifyFailureCause(handlerStage, { error: tail })).toBe('network');
  });

  it('explicit platformError wins', () => {
    expect(
      classifyFailureCause(handlerStage, { platformError: 'EHOSTUNREACH', error: undefined }),
    ).toBe('network');
  });

  it('scans a soft-fail response message for a Chromium net:: error', () => {
    // The soft-fail path only has prose: R.fail(error) serialises the message
    // and drops the Error instance, so the platform marker is the last
    // structural thing left.
    expect(
      classifyFailureCause(handlerStage, {
        platformError: 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.test/',
      }),
    ).toBe('network');
    expect(
      classifyFailureCause(handlerStage, {
        platformError: 'page.goto: net::ERR_CONNECTION_CLOSED at https://x.test/',
      }),
    ).toBe('target_gone');
  });

  it('leaves an unmarked soft-fail message at the stage kind', () => {
    expect(classifyFailureCause(handlerStage, { platformError: 'Something odd happened' })).toBe(
      'handler',
    );
  });

  it('classifies a soft-fail timeout message as timeout', () => {
    expect(
      classifyFailureCause(handlerStage, {
        platformError: 'Navigation timeout of 30000 ms exceeded',
      }),
    ).toBe('timeout');
  });
});
