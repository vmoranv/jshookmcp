/**
 * Instrumentation contract for jshhookmcp.
 *
 * Defines a minimal span/metric interface that can be backed by OpenTelemetry,
 * Prometheus, or a no-op implementation. The NoopInstrumentation is used by
 * default until a real exporter is configured.
 */

/* ---------- Types ---------- */

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface SpanLike {
  readonly name: string;
  readonly startTime: number;
  end(attrs?: Record<string, unknown>): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
}

/* ---------- Contract ---------- */

export interface InstrumentationContract {
  startSpan(name: string, attrs?: Record<string, unknown>): SpanLike;
  emitMetric(
    name: string,
    value: number,
    type: MetricType,
    attrs?: Record<string, unknown>,
  ): void;
  flush?(): Promise<void>;
}

/* ---------- Well-known names ---------- */

export const SpanNames = {
  toolExecute: 'tool.execute',
  toolValidateInput: 'tool.validate_input',
  registryDiscovery: 'registry.discovery',
  pluginLifecycle: 'plugin.lifecycle',
  workflowRun: 'workflow.run',
  workflowStep: 'workflow.step',
  bridgeRequest: 'bridge.request',
  captchaSolve: 'captcha.solve',
} as const;

export const MetricNames = {
  toolCallsTotal: 'tool_calls_total',
  toolErrorsTotal: 'tool_errors_total',
  toolDurationMs: 'tool_duration_ms',
  workflowRunsTotal: 'workflow_runs_total',
  workflowErrorsTotal: 'workflow_errors_total',
  workflowDurationMs: 'workflow_duration_ms',
  bridgeRequestsTotal: 'bridge_requests_total',
  bridgeDurationMs: 'bridge_duration_ms',
  pluginActiveTotal: 'plugin_active_total',
} as const;

/* ---------- No-op implementation ---------- */

export class NoopInstrumentation implements InstrumentationContract {
  startSpan(name: string): SpanLike {
    const startTime = Date.now();
    return {
      name,
      startTime,
      end() { /* no-op */ },
      addEvent() { /* no-op */ },
    };
  }

  emitMetric(): void {
    /* no-op */
  }
}
