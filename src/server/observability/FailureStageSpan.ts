/**
 * Metadata-only stage spans for the tool-execution pipeline.
 *
 * The failure metric could name the tool but not the STEP that failed: a
 * factory that refuses a restored session and a browser that will not launch
 * both surfaced as `handler`, which has no single fix. This helper stamps a
 * span around one pipeline stage (session restore, gate admission, ...) whose
 * end attributes say only whether the stage succeeded — no arguments, no
 * error text — and hands the thrown value to a callback so the caller can
 * classify it with the structural signals it already has.
 *
 * The span is emitted when the entrypoint is per-process (`bin`): under a
 * shared server every agent's stages interleave into one trace, where a stage
 * span cannot be tied to the call that needs it. The callback runs either way,
 * because it is what fills the failure verdict the metrics read.
 */
import {
  SpanNames,
  type InstrumentationContract,
} from '@server/observability/InstrumentationContract';
import { readEntrypointKind } from '@server/observability/launchSignals';

/**
 * Run one stage with a metadata span around it, recording the failure verdict
 * before rethrowing.
 *
 * `onError` must not throw; a throwing classifier would replace the real
 * failure with a telemetry failure.
 */
export async function failureStageSpan<T>(
  instrumentation: InstrumentationContract,
  toolName: string,
  stage: string,
  run: () => Promise<T>,
  onError: (error: unknown) => void,
): Promise<T> {
  const span =
    readEntrypointKind() === 'bin'
      ? instrumentation.startSpan(SpanNames.toolExecuteStage, { toolName, stage })
      : null;
  try {
    const value = await run();
    span?.end({ ok: true });
    return value;
  } catch (error) {
    try {
      onError(error);
    } catch {
      /* the classifier must never replace the real failure */
    }
    span?.end({ ok: false });
    throw error;
  }
}
