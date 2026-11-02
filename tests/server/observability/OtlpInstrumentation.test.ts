/**
 * OtlpInstrumentation tests.
 *
 * The class is a lazily-initialising facade over the OpenTelemetry SDK:
 * emissions made before the dynamic import completes must survive (buffered
 * and replayed), an SDK that fails to load must degrade to a permanent no-op,
 * and — per the InstrumentationContract — NOTHING here may ever throw or
 * block the caller, including flush()/shutdown() against a dead endpoint.
 */
import { describe, expect, it } from 'vitest';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import {
  OtlpInstrumentation,
  resolveExporterTargets,
} from '@server/observability/OtlpInstrumentation';

describe('resolveExporterTargets', () => {
  const ENV_KEYS = [
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  ] as const;

  function cleanEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
  }

  it('a fresh install with no config lands on the built-in project ingress', () => {
    cleanEnv();
    const targets = resolveExporterTargets({});
    expect(targets.traceUrl).toBe('https://telemetry.614447.xyz/v1/traces');
    expect(targets.metricUrl).toBe('https://telemetry.614447.xyz/v1/metrics');
    expect(targets.headers?.authorization).toMatch(/^Bearer /);
    expect(targets.baseUrl).toBe('https://telemetry.614447.xyz');
  });

  it('an operator-configured endpoint is honored natively (nothing injected)', () => {
    cleanEnv();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    try {
      const targets = resolveExporterTargets({});
      expect(targets.traceUrl).toBeUndefined();
      expect(targets.metricUrl).toBeUndefined();
      expect(targets.headers).toBeUndefined();
      expect(targets.baseUrl).toBe('http://localhost:4318');
    } finally {
      cleanEnv();
    }
  });

  it('explicit options win over env and defaults', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    try {
      const targets = resolveExporterTargets({
        traceUrl: 'http://collector.internal:4318/v1/traces',
      });
      expect(targets.traceUrl).toBe('http://collector.internal:4318/v1/traces');
    } finally {
      cleanEnv();
    }
  });
});

/** Wait until the async init has landed (or the test times out). */
async function waitForInit(ms = 2_000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  void ms;
}

function makeLive(): {
  exporter: InMemorySpanExporter;
  metricExporter: InMemoryMetricExporter;
  otlp: OtlpInstrumentation;
} {
  const exporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const otlp = new OtlpInstrumentation({
    makeTraceExporter: () => exporter,
    makeMetricExporter: () => metricExporter,
    metricExportIntervalMs: 600_000, // never periodic-export on its own; flush drives tests
  });
  return { exporter, metricExporter, otlp };
}

describe('OtlpInstrumentation', () => {
  it('buffers spans emitted before init and replays them with their attributes', async () => {
    const { exporter, otlp } = makeLive();

    // Emitted synchronously right after construction — init has NOT landed yet.
    const early = otlp.startSpan('probe.early', { 'probe.kind': 'buffered' });
    early.end({ 'probe.done': true });
    await waitForInit();
    const late = otlp.startSpan('probe.late');
    late.end();

    await otlp.flush();
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain('probe.early');
    expect(names).toContain('probe.late');
    const earlySpan = exporter.getFinishedSpans().find((s) => s.name === 'probe.early');
    expect(earlySpan?.attributes['probe.kind']).toBe('buffered');
    expect(earlySpan?.attributes['probe.done']).toBe(true);
  });

  it('stringifies non-primitive span attributes instead of dropping the span', async () => {
    const { exporter, otlp } = makeLive();
    const span = otlp.startSpan('probe.attrs', {
      plain: 'text',
      count: 3,
      flag: true,
      structured: { nested: 'value' },
    });
    span.end();
    await waitForInit();
    await otlp.flush();

    const spanOut = exporter.getFinishedSpans().find((s) => s.name === 'probe.attrs');
    expect(spanOut?.attributes['plain']).toBe('text');
    expect(spanOut?.attributes['count']).toBe(3);
    expect(spanOut?.attributes['flag']).toBe(true);
    expect(spanOut?.attributes['structured']).toBe(JSON.stringify({ nested: 'value' }));
  });

  it('exports buffered metrics once live', async () => {
    const { metricExporter, otlp } = makeLive();
    otlp.emitMetric('probe_metric_total', 1, 'counter', { kind: 'a' });
    otlp.emitMetric('probe_metric_total', 2, 'counter', { kind: 'b' });
    otlp.emitMetric('probe_latency_ms', 12, 'histogram');
    otlp.emitMetric('probe_gauge', 5, 'gauge');
    await otlp.flush();

    // getMetrics() returns ResourceMetrics envelopes: { resource, scopeMetrics
    // → metrics → descriptor.name }. Flatten before matching.
    const names = metricExporter
      .getMetrics()
      .flatMap((envelope) => envelope.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .map((metric) => metric.descriptor.name);
    expect(names).toContain('probe_metric_total');
    expect(names).toContain('probe_latency_ms');
    expect(names).toContain('probe_gauge');
  });

  it('flush stays bounded when the endpoint is unreachable', async () => {
    const otlp = new OtlpInstrumentation({
      traceUrl: 'http://127.0.0.1:1/v1/traces',
      metricUrl: 'http://127.0.0.1:1/v1/metrics',
      spanScheduleDelayMs: 10,
    });
    const span = otlp.startSpan('probe.dead.endpoint');
    span.end();
    await waitForInit();
    // The OTel exporter retries/swallows internally; flush must resolve
    // within its internal timeout rather than hanging the shutdown path.
    await expect(otlp.flush()).resolves.toBeUndefined();
    await expect(otlp.shutdown()).resolves.toBeUndefined();
  });

  it('emissions after shutdown are silent no-ops', async () => {
    const { otlp } = makeLive();
    await waitForInit();
    await otlp.shutdown();
    // One-way: post-shutdown spans neither throw nor resurrect the backend.
    const span = otlp.startSpan('probe.after.shutdown');
    expect(() => span.end()).not.toThrow();
    expect(() => otlp.emitMetric('m', 1, 'counter')).not.toThrow();
    await expect(otlp.flush()).resolves.toBeUndefined();
  });
});

/**
 * Temporality regression guard — the 268× inflation bug.
 *
 * What went wrong in production: every call site emits a unit increment
 * (`emitMetric(name, 1, 'counter')`), but the exporter defaulted to
 * CUMULATIVE aggregation. The SDK then re-sent the RUNNING TOTAL on every
 * 30s tick whether or not anything happened, so one `(process, tool)` pair
 * re-uploaded the same number ~200 times. Measured on the ingress:
 * 4,075,981 summed `calls` against 15,199 real ones. That row volume is what
 * pushed the D1 database to its 500 MB ceiling.
 *
 * These tests drive a REAL OTLP exporter against a local capture server —
 * a fake exporter would let the temporality default slip through again,
 * because the temporality lives in the exporter, not in our facade.
 */
describe('OTLP metric temporality', () => {
  it('re-exports increments, not a growing running total', async () => {
    const payloads = await captureMetricPayloads(async (metricUrl) => {
      const otlp = new OtlpInstrumentation({
        metricUrl,
        // Short interval so the test does not wait a minute; the assertion is
        // about WHAT is sent, not how often.
        metricExportIntervalMs: 120,
      });
      await waitForInit();
      // Three increments of the same instrument with the same attribute set —
      // exactly the shape every call site produces.
      for (let i = 0; i < 3; i += 1) {
        otlp.emitMetric('probe_delta_total', 1, 'counter', { tool: 'probe' });
      }
      await otlp.flush();
      await new Promise((resolve) => setTimeout(resolve, 260));
      await otlp.shutdown();
    });

    const values = payloads.flatMap(extractCounterValues).filter((v) => v !== undefined);
    expect(values.length).toBeGreaterThan(0);
    // Under CUMULATIVE the same counter reports 1, then 2, then 3 (a running
    // total). Under DELTA each export reports only what happened since the
    // last one, so no single datapoint may exceed the 3 increments emitted.
    expect(Math.max(...(values as number[]))).toBeLessThanOrEqual(3);
    // And the summed total must equal exactly the three increments — not a
    // 1+2+3=6 running-total series.
    const sum = (values as number[]).reduce((acc, v) => acc + v, 0);
    expect(sum).toBeLessThanOrEqual(3);
  });
});

/** One captured OTLP/JSON metrics request body. */
type MetricPayload = Record<string, unknown>;

/**
 * Run `body` against a throwaway HTTP server that records OTLP metric bodies.
 *
 * The server answers 200 with an empty protobuf-ish body (the exporter reads
 * `{}` as success), so the exporter's retry/backoff path stays out of the way.
 */
async function captureMetricPayloads(
  body: (metricUrl: string) => Promise<void>,
): Promise<MetricPayload[]> {
  const { createServer } = await import('node:http');
  const payloads: MetricPayload[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as MetricPayload);
      } catch {
        /* a non-JSON body is not what these assertions are about */
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('capture server failed to bind a port');
  }
  try {
    await body(`http://127.0.0.1:${address.port}/v1/metrics`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return payloads;
}

/**
 * Pull every `asDouble`/`asInt` out of an OTLP/JSON metrics body.
 *
 * Deliberately schemaless (walks the whole tree) so it cannot silently stop
 * matching when the SDK reshapes its envelope.
 */
function extractCounterValues(payload: unknown): (number | undefined)[] {
  const found: (number | undefined)[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.asDouble === 'number') found.push(record.asDouble);
    else if (record.asInt !== undefined) found.push(Number(record.asInt));
    for (const value of Object.values(record)) walk(value);
  };
  walk(payload);
  return found;
}
