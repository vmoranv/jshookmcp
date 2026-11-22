/**
 * OtlpInstrumentation degradation path — separate file on purpose.
 *
 * vi.mock only intercepts modules that are not yet in the module registry at
 * hoist time. Mocking '@opentelemetry/sdk-trace' from inside the shared
 * OtlpInstrumentation test file would be too late (earlier tests there load
 * the real SDK), so this scenario lives in its own file where the top-level
 * mock applies before anything imports the SDK.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@opentelemetry/sdk-trace', () => {
  throw new Error('optional dependency missing');
});

// Imported AFTER the mock declaration: vitest hoists vi.mock above imports,
// so OtlpInstrumentation's dynamic import hits the throwing factory.
import { OtlpInstrumentation } from '@server/observability/OtlpInstrumentation';

describe('OtlpInstrumentation degradation', () => {
  it('degrades to a permanent no-op when the OpenTelemetry SDK cannot load', async () => {
    const onInitError = vi.fn();
    const otlp = new OtlpInstrumentation({ onInitError });
    await otlp.flush(); // awaits the (failed) init first

    // Contract: every call still works, does nothing, and never throws.
    const span = otlp.startSpan('probe.broken', { a: 1 });
    expect(() => span.end()).not.toThrow();
    expect(() => span.addEvent('evt')).not.toThrow();
    expect(() => otlp.emitMetric('m', 1, 'counter')).not.toThrow();
    await expect(otlp.flush()).resolves.toBeUndefined();
    await expect(otlp.shutdown()).resolves.toBeUndefined();
    expect(onInitError).toHaveBeenCalledTimes(1);
    // vitest wraps factory-thrown mock errors with a `cause` chain; assert
    // OUR error is the cause rather than depending on the wrapper's message.
    const reported = onInitError.mock.calls[0]![0] as { cause?: { message?: string } };
    expect(reported.cause?.message).toBe('optional dependency missing');
  });
});
