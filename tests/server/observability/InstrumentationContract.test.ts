import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MetricNames,
  NoopInstrumentation,
  SpanNames,
} from '@server/observability/InstrumentationContract';

describe('observability/InstrumentationContract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes stable span and metric names', () => {
    expect(SpanNames).toEqual({
      toolExecute: 'tool.execute',
      toolValidateInput: 'tool.validate_input',
      registryDiscovery: 'registry.discovery',
      pluginLifecycle: 'plugin.lifecycle',
      workflowRun: 'workflow.run',
      workflowStep: 'workflow.step',
      bridgeRequest: 'bridge.request',
      captchaSolve: 'captcha.solve',
    });
    expect(MetricNames.pluginActiveTotal).toBe('plugin_active_total');
  });

  it('returns a no-op span with the current timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    const instrumentation = new NoopInstrumentation();

    const span = instrumentation.startSpan('workflow.run', { id: 'wf-1' });

    expect(span.name).toBe('workflow.run');
    expect(span.startTime).toBe(12345);
    expect(() => span.addEvent('started')).not.toThrow();
    expect(() => span.end({ ok: true })).not.toThrow();
    expect(() => instrumentation.emitMetric('workflow_runs_total', 1, 'counter')).not.toThrow();
  });
});
