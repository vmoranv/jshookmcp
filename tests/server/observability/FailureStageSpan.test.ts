/**
 * Stage spans: the step that failed, not just the tool.
 *
 * The product question this answers is "did the browser refuse a restored
 * session, or did it never start?" — a factory throw and a launch failure used
 * to land in the same `handler` bucket with no way to tell them apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { failureStageSpan } from '@server/observability/FailureStageSpan';
import { installLaunchSignals, resetLaunchSignals } from '@server/observability/launchSignals';
import { SpanNames } from '@server/observability/InstrumentationContract';
import { RecordingInstrumentation } from '@tests/shared/recording-instrumentation';

function makeInstrumentation() {
  return new RecordingInstrumentation();
}

beforeEach(() => {
  resetLaunchSignals();
  installLaunchSignals({ entrypoint: 'bin' });
});

describe('failureStageSpan', () => {
  it('ends the span ok:true and returns the value when the stage succeeds', async () => {
    const instrumentation = makeInstrumentation();
    const value = await failureStageSpan(
      instrumentation,
      'page_navigate',
      'session_restore',
      async () => 42,
      () => {
        throw new Error('must not run');
      },
    );
    expect(value).toBe(42);
    const spans = instrumentation.spansNamed(SpanNames.toolExecuteStage);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.endAttrs).toEqual({ ok: true });
  });

  it('records the stage as NOT ok and hands the error to the classifier', async () => {
    const instrumentation = makeInstrumentation();
    const seen: unknown[] = [];
    const boom = new Error('factory refused the restored session');
    await expect(
      failureStageSpan(
        instrumentation,
        'page_navigate',
        'session_restore',
        async () => {
          throw boom;
        },
        (error) => seen.push(error),
      ),
    ).rejects.toBe(boom);
    expect(seen).toEqual([boom]);
    expect(instrumentation.spansNamed(SpanNames.toolExecuteStage)[0]!.endAttrs).toEqual({
      ok: false,
    });
  });

  it('rethrows the ORIGINAL error when the classifier itself throws', async () => {
    // Telemetry must never replace the real failure with its own.
    const instrumentation = makeInstrumentation();
    const boom = new Error('the real one');
    await expect(
      failureStageSpan(
        instrumentation,
        'page_navigate',
        'fleet_admit',
        async () => {
          throw boom;
        },
        () => {
          throw new Error('classifier exploded');
        },
      ),
    ).rejects.toBe(boom);
  });

  it('emits no span for a shared (library) entrypoint but still classifies', async () => {
    // Under one shared server the stage spans of different agents interleave,
    // so a stage cannot be tied back to the call that needs it.
    resetLaunchSignals();
    installLaunchSignals({ entrypoint: 'library' });
    const instrumentation = makeInstrumentation();
    const seen: unknown[] = [];
    const boom = new Error('x');
    await expect(
      failureStageSpan(
        instrumentation,
        'page_navigate',
        'session_restore',
        async () => {
          throw boom;
        },
        (error) => seen.push(error),
      ),
    ).rejects.toBe(boom);
    expect(instrumentation.spansNamed(SpanNames.toolExecuteStage)).toHaveLength(0);
    expect(seen).toEqual([boom]);
  });

  it('carries only metadata: toolName and stage, never arguments or messages', async () => {
    const instrumentation = makeInstrumentation();
    const start = vi.spyOn(instrumentation, 'startSpan');
    await failureStageSpan(
      instrumentation,
      'page_navigate',
      'session_restore',
      async () => undefined,
      () => {},
    );
    expect(start).toHaveBeenCalledWith(SpanNames.toolExecuteStage, {
      toolName: 'page_navigate',
      stage: 'session_restore',
    });
  });
});
