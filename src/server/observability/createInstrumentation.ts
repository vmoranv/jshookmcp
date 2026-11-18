/**
 * Choose the instrumentation implementation from config.
 *
 * Kept out of `InstrumentationContract.ts` so the contract module stays free
 * of config types, and out of `MCPServer` so the decision is testable on its
 * own.
 *
 * The default is `NoopInstrumentation`: a library should not pay for telemetry
 * the embedder did not ask for, and the contract explicitly allows a no-op.
 * `observability.exporter: 'memory'` opts into `InMemoryInstrumentation`,
 * which is bounded and inspectable from inside the process — the option that
 * makes "is the instrumentation actually working?" answerable.
 * `observability.exporter: 'otlp'` opts into `OtlpInstrumentation`, which
 * streams spans/metrics to any OTLP endpoint (self-hosted collector, SigNoz,
 * Grafana Cloud, a Cloudflare Worker receiver — configured through the
 * standard OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS env vars
 * that the exporters read natively).
 *
 * The switch is real: it selects a different object with different behaviour.
 * A config key that changes nothing would be its own instance of the defect
 * class this work exists to remove.
 */

import type { Config } from '@internal-types/index';
import { logger } from '@utils/logger';
import { InMemoryInstrumentation } from './InMemoryInstrumentation';
import { type InstrumentationContract, NoopInstrumentation } from './InstrumentationContract';
import { OtlpInstrumentation } from './OtlpInstrumentation';

export function createInstrumentation(
  config: Pick<Config, 'observability'>,
): InstrumentationContract {
  // Test suites must never emit NETWORK telemetry: with exporter=otlp as the
  // shipped default, every MCPServer constructed under vitest would otherwise
  // start exporters pointing at the real ingress. The in-process `memory`
  // backend stays functional in tests.
  if (process.env.NODE_ENV === 'test') {
    const resolved = config.observability?.exporter ?? 'otlp';
    if (resolved === 'otlp') return new NoopInstrumentation();
  }
  const settings = config.observability;
  if (settings?.exporter === 'memory') {
    return new InMemoryInstrumentation(settings.maxSpans);
  }
  if (settings?.exporter === 'otlp') {
    return new OtlpInstrumentation({
      // Wired from config so an operator can trade metric resolution for
      // row volume without a code change; see ObservabilityConfig.
      ...(typeof settings?.metricExportIntervalMs === 'number'
        ? { metricExportIntervalMs: settings.metricExportIntervalMs }
        : {}),
      // The OTel SDK loads via dynamic import from optionalDependencies; a
      // missing package or a broken provider build degrades the instance to
      // a no-op. Telemetry must never take the server down with it.
      onInitError: (error) => {
        logger.warn(
          `[observability] OTLP exporter degraded to no-op: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    });
  }
  return new NoopInstrumentation();
}
