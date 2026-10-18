/**
 * Search-engine telemetry tests: the `search.query` span and search metrics
 * emitted through the process-global instrumentation.
 *
 * The engine has no config access by design — it reads the global
 * instrumentation installed by MCPServer. In production that is the OTLP
 * exporter; in search-tune worker processes nothing is installed, so tuning
 * runs emit nothing. These tests install InMemoryInstrumentation as the
 * global and assert the span/metric shapes the lakehouse analysis relies on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_CONFIG } from '@src/config/search-defaults';
import { ToolSearchEngine } from '@server/search/ToolSearchEngineImpl';
import type {
  InstrumentationContract,
  MetricType,
  SpanLike,
} from '@server/observability/InstrumentationContract';
import {
  resetGlobalInstrumentation,
  setGlobalInstrumentation,
} from '@server/observability/InstrumentationContract';
import {
  resetGlobalQueryTextPolicy,
  setGlobalQueryTextPolicy,
} from '@server/observability/queryTextPolicy';

interface RecordedSpan {
  name: string;
  attrs: Record<string, unknown>;
  endAttrs: Record<string, unknown>;
}

interface RecordedMetric {
  name: string;
  value: number;
  type: MetricType;
  attrs: Record<string, unknown>;
}

/**
 * Local recording stub, NOT InMemoryInstrumentation: the in-memory backend
 * aggregates metrics by name and keeps no per-sample attributes, but these
 * tests must assert the attribute shapes (outcome, rank_bucket, tool) that
 * the lakehouse analysis depends on.
 */
class RecordingInstrumentation implements InstrumentationContract {
  readonly spans: RecordedSpan[] = [];
  readonly metrics: RecordedMetric[] = [];

  startSpan(name: string, attrs?: Record<string, unknown>): SpanLike {
    const record: RecordedSpan = { name, attrs: { ...attrs }, endAttrs: {} };
    this.spans.push(record);
    const startTime = Date.now();
    return {
      name,
      startTime,
      end: (endAttrs?: Record<string, unknown>) => Object.assign(record.endAttrs, endAttrs ?? {}),
      addEvent: () => undefined,
    };
  }

  emitMetric(name: string, value: number, type: MetricType, attrs?: Record<string, unknown>): void {
    this.metrics.push({ name, value, type, attrs: { ...attrs } });
  }
}

function makeTools() {
  return [
    {
      name: 'probe_hook_fetch',
      description: 'Hook the fetch API on the current page and inspect request bodies.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'probe_decode_base64',
      description: 'Decode base64 encoded payloads from captured traffic.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ];
}

function makeEngine(): ToolSearchEngine {
  // domainOverrides for every probe tool: without them the constructor falls
  // back to getToolDomain(), which requires an initialised registry — this
  // file deliberately exercises the engine standalone.
  const domainOverrides = new Map<string, string>([
    ['probe_hook_fetch', 'probe'],
    ['probe_decode_base64', 'probe'],
  ]);
  // Pin vector OFF explicitly. This file asserts telemetry SHAPE, and
  // DEFAULT_SEARCH_CONFIG is the lexical-only baseline — passing it keeps the
  // test independent of the process-wide SEARCH_VECTOR_ENABLED default, which
  // is now on for every transport. Left implicit, the engine spawned a real
  // embedding worker and reported vector_participated=true.
  return new ToolSearchEngine(
    makeTools(),
    domainOverrides,
    undefined,
    undefined,
    DEFAULT_SEARCH_CONFIG,
  );
}

describe('ToolSearchEngine telemetry', () => {
  let instrumentation: RecordingInstrumentation;

  afterEach(() => {
    resetGlobalInstrumentation();
    resetGlobalQueryTextPolicy();
  });

  function install(): RecordingInstrumentation {
    instrumentation = new RecordingInstrumentation();
    setGlobalInstrumentation(instrumentation);
    return instrumentation;
  }

  it('emits one search.query span per full-path search with ranking telemetry', async () => {
    install();
    const engine = makeEngine();
    await engine.search('inspect request bodies from the page');

    expect(instrumentation.spans).toHaveLength(1);
    const span = instrumentation.spans[0]!;
    expect(span.name).toBe('search.query');
    expect(span.endAttrs['search.quick_path']).toBe(false);
    expect(span.endAttrs['search.vector_participated']).toBe(false);
    expect(typeof span.endAttrs['search.result_count']).toBe('number');
    expect(typeof span.endAttrs['search.latency_ms']).toBe('number');
  });

  it('captures the query text per the global policy (truncated by default)', async () => {
    install();
    const engine = makeEngine();
    const longQuery = `${'inspect '.repeat(12)}request bodies`;
    await engine.search(longQuery);

    const attr = instrumentation.spans[0]!.attrs['search.query_text'];
    expect(typeof attr).toBe('string');
    expect(String(attr).length).toBeLessThanOrEqual(64 + 20);
    expect(attr).not.toBe(longQuery);

    setGlobalQueryTextPolicy('full');
    await engine.search(longQuery);
    expect(instrumentation.spans.at(-1)!.attrs['search.query_text']).toBe(longQuery);
  });

  it('marks quick-path searches (exact tool name) with quick_path=true', async () => {
    install();
    const engine = makeEngine();
    await engine.search('probe_hook_fetch');

    const span = instrumentation.spans[0]!;
    expect(span.endAttrs['search.quick_path']).toBe(true);
  });

  it('marks cache hits distinctly — second identical query never re-scores', async () => {
    install();
    const engine = makeEngine();
    await engine.search('inspect request bodies from the page');
    await engine.search('inspect request bodies from the page');

    expect(instrumentation.spans).toHaveLength(2);
    expect(instrumentation.spans[1]!.endAttrs['search.cache_hit']).toBe(true);
  });

  it('emits search_queries_total / search_latency_ms metrics with an outcome attr', async () => {
    install();
    const engine = makeEngine();
    await engine.search('inspect request bodies from the page');

    const names = instrumentation.metrics.map((m) => m.name);
    expect(names).toContain('search_queries_total');
    expect(names).toContain('search_latency_ms');
    const total = instrumentation.metrics.find((m) => m.name === 'search_queries_total')!;
    expect(String(total.attrs['outcome'])).toMatch(/^full_path_/);
  });

  it('emits search_feedback_used with a rank bucket when a tool call follows a search', async () => {
    install();
    const engine = makeEngine();
    const results = await engine.search('inspect request bodies from the page');
    engine.associateLastSearch(results[0]!.name);

    const feedback = instrumentation.metrics.filter((m) => m.name === 'search_feedback_used');
    expect(feedback).toHaveLength(1);
    expect(feedback[0]!.attrs['rank_bucket']).toBe('top1');
    expect(feedback[0]!.attrs['tool']).toBe(results[0]!.name);
  });

  it('emits nothing when no instrumentation is installed (tuning workers)', async () => {
    resetGlobalInstrumentation();
    const engine = makeEngine();
    await expect(engine.search('inspect request bodies from the page')).resolves.toBeDefined();
    // No throw, no crash — the no-op default carries the whole contract.
  });
});
