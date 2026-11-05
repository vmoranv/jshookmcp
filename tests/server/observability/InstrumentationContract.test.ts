/**
 * Behaviour of the instrumentation contract's own primitives.
 *
 * The load-bearing claim here is the FALLBACK: `resolveInstrumentation` must
 * never be the reason a tool call fails. Tests and degraded startup paths pass
 * partial contexts (`ctx as never`) with no domain-instance map at all, so a
 * missing instrumentation has to resolve to a working no-op rather than throw.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  getGlobalInstrumentation,
  INSTRUMENTATION_DOMAIN_KEY,
  NoopInstrumentation,
  resetGlobalInstrumentation,
  resolveInstrumentation,
  setGlobalInstrumentation,
  SpanNames,
} from '@server/observability/InstrumentationContract';
import { RecordingInstrumentation } from '@tests/shared/recording-instrumentation';

describe('NoopInstrumentation', () => {
  it('returns a usable span whose methods never throw', () => {
    const noop = new NoopInstrumentation();
    const span = noop.startSpan(SpanNames.toolExecute, { toolName: 'x' });
    expect(span.name).toBe(SpanNames.toolExecute);
    expect(span.startTime).toBeGreaterThan(0);
    expect(() => span.addEvent('event')).not.toThrow();
    expect(() => span.end({ ok: true })).not.toThrow();
  });

  it('emitMetric accepts every metric type without throwing', () => {
    const noop = new NoopInstrumentation();
    expect(() => noop.emitMetric('x', 1, 'counter')).not.toThrow();
    expect(() => noop.emitMetric('x', 2, 'gauge', { a: 1 })).not.toThrow();
    expect(() => noop.emitMetric('x', 3, 'histogram')).not.toThrow();
  });
});

describe('resolveInstrumentation', () => {
  it('reads the implementation registered under the instrumentation domain key', () => {
    const recording = new RecordingInstrumentation();
    const host = {
      getDomainInstance: <T>(key: string): T | undefined =>
        key === INSTRUMENTATION_DOMAIN_KEY ? (recording as unknown as T) : undefined,
    };

    expect(resolveInstrumentation(host)).toBe(recording);
  });

  it('falls back to a no-op when the host has no domain-instance map', () => {
    // `{} as MCPServerContext` is the shape a partial test context has.
    expect(() => resolveInstrumentation({} as never)).not.toThrow();
    expect(resolveInstrumentation({} as never)).toBeInstanceOf(NoopInstrumentation);
    expect(resolveInstrumentation(undefined)).toBeInstanceOf(NoopInstrumentation);
  });

  it('falls back to a no-op when the key is absent from the map', () => {
    const host = { getDomainInstance: <T>(_key: string): T | undefined => undefined };
    expect(resolveInstrumentation(host)).toBeInstanceOf(NoopInstrumentation);
  });

  it('does not consult a host whose getDomainInstance is not callable', () => {
    const host = { getDomainInstance: 'not a function' } as unknown as {
      getDomainInstance: <T>(key: string) => T | undefined;
    };
    expect(resolveInstrumentation(host)).toBeInstanceOf(NoopInstrumentation);
  });
});

describe('global instrumentation', () => {
  afterEach(() => {
    resetGlobalInstrumentation();
  });

  it('defaults to a no-op before anything installs one', () => {
    expect(getGlobalInstrumentation()).toBeInstanceOf(NoopInstrumentation);
  });

  it('installs and restores', () => {
    const recording = new RecordingInstrumentation();
    setGlobalInstrumentation(recording);
    expect(getGlobalInstrumentation()).toBe(recording);

    resetGlobalInstrumentation();
    expect(getGlobalInstrumentation()).toBeInstanceOf(NoopInstrumentation);
  });
});
