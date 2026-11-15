/**
 * Cold-start latency contract for the vector bootstrap.
 *
 * Production telemetry (2026-11-15) showed ~10.6s search queries whose
 * `vector_participated` was false, clustered on fresh installs: the query
 * path awaited the one-time model download + full-catalog embed. A slow or
 * blocked network turns that into a user-visible stall on EVERY query once
 * the retry cooldown expires and the next query re-enters the bootstrap.
 *
 * Contract locked here:
 *   1. A query issued while the catalog embeddings are still being built
 *      resolves immediately, from BM25 + trigram, without waiting.
 *   2. The bootstrap still runs (it is kicked in the background).
 *   3. A later query picks up the vector signal once the bootstrap lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@modelcontextprotocol/server';
import type { InstrumentationContract } from '@server/observability/InstrumentationContract';

const state = vi.hoisted(() => ({
  allTools: [] as Tool[],
  embedBatchCalls: 0,
  /** Resolved by the test to release the in-flight bootstrap. */
  releaseBootstrap: null as null | (() => void),
  embed: vi.fn(async (_text: string) => new Float32Array([1, 0, 0])),
  /**
   * Per-call overrides for the embedding bootstrap, in order. Each entry is
   * either 'fail' (reject, simulating a failed prewarm) or 'gate' (hang until
   * the test calls releaseBootstrap). Lets a test drive the retry-cooldown
   * path instead of always taking the in-flight-prewarm fast path.
   */
  embedBatchBehaviors: [] as Array<'fail' | 'gate'>,
}));

/**
 * `outcome` values the search pipeline emitted, in order.
 *
 * This is the pipeline's own statement about whether the vector ranking fed
 * the result — the signal production telemetry reads. Asserting on it makes
 * the test fail if fusion computes embeddings and then discards them.
 */
const searchOutcomes: string[] = [];

/**
 * Capture the outcome without replacing the whole instrumentation contract:
 * only the metric sink is observed, so spans and everything else keep their
 * real behavior.
 */
vi.mock('@server/observability/InstrumentationContract', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@server/observability/InstrumentationContract')>();
  const capture: InstrumentationContract = {
    // Spans are not the subject here; a no-op keeps the mock shallow.
    startSpan: () => ({ name: '', startTime: Date.now(), end: () => {}, addEvent: () => {} }),
    emitMetric(name, _value, _type, attrs) {
      const outcome = attrs?.['outcome'];
      if (
        name === actual.MetricNames.searchQueriesTotal &&
        typeof outcome === 'string' &&
        // Only the full-path outcome names a path; skip the other counters
        // (cache_hit, quick_path, below_confidence_floor) that share the name.
        (outcome === 'full_path_vector' || outcome === 'full_path_lexical')
      ) {
        searchOutcomes.push(outcome);
      }
    },
  };
  return { ...actual, getGlobalInstrumentation: () => capture };
});

vi.mock('@server/ToolCatalog', () => ({
  get allTools() {
    return state.allTools;
  },
  getToolDomain: () => null,
}));

vi.mock('@server/search/EmbeddingEngine', () => ({
  EmbeddingEngine: class {
    embed(text: string) {
      return state.embed(text);
    }
    async embedBatch(texts: string[]) {
      state.embedBatchCalls += 1;
      const behavior = state.embedBatchBehaviors.shift() ?? 'gate';
      if (behavior === 'fail') {
        throw new Error('simulated embedding bootstrap failure');
      }
      // Gate the bootstrap so the test controls when it lands.
      const { promise, resolve } = Promise.withResolvers<void>();
      state.releaseBootstrap = resolve;
      await promise;
      return texts.map(() => new Float32Array([1, 0, 0]));
    }
  },
}));

vi.mock('@src/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/constants')>();
  return {
    ...actual,
    SEARCH_VECTOR_PREWARM: true,
    SEARCH_VECTOR_CACHE_ENABLED: false,
    SEARCH_QUERY_CACHE_CAPACITY: 8,
    // Cooldown is zero so the retry-cooldown path is immediately reachable;
    // the test still drives it through a failed prewarm, not a timer.
    SEARCH_VECTOR_RETRY_COOLDOWN_MS: 0,
    // No BM25 skip threshold: the warm query must actually reach the vector
    // stage, otherwise the "vectors participate" claim below could be vacuously
    // true (strong lexical hit → vector skipped → nothing to observe).
    SEARCH_VECTOR_BM25_SKIP_THRESHOLD: 0,
  };
});

function makeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
  } as unknown as Tool;
}

let previousCacheDir: string | undefined;
let cacheDir: string | undefined;

describe('search cold-start: a query never waits for the vector bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    state.embedBatchCalls = 0;
    state.embedBatchBehaviors = [];
    state.releaseBootstrap = null;
    state.embed.mockClear();
    previousCacheDir = process.env['JSHOOK_EMBEDDING_CACHE_DIR'];
    cacheDir = mkdtempSync(join(tmpdir(), 'jshook-coldstart-'));
    process.env['JSHOOK_EMBEDDING_CACHE_DIR'] = cacheDir;

    state.allTools = [
      makeTool('page_navigate', 'Navigate the browser to a url'),
      makeTool('page_click', 'Click an element on the page'),
      makeTool('network_get_requests', 'List captured network requests'),
    ];
  });

  afterEach(() => {
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
    cacheDir = undefined;
    if (previousCacheDir === undefined) delete process.env['JSHOOK_EMBEDDING_CACHE_DIR'];
    else process.env['JSHOOK_EMBEDDING_CACHE_DIR'] = previousCacheDir;
  });

  it(
    'resolves from lexical signals while the bootstrap is still in flight, then upgrades',
    { timeout: 15_000 },
    async () => {
      const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
      const engine = new ToolSearchEngine();

      // Cold-start query while embedBatch is still pending. It must return
      // without the bootstrap being released: the await below resolving (while
      // releaseBootstrap is still uncalled) IS the non-blocking assertion.
      // No wall-clock budget: a loaded CI host stalling for >2s must not fail
      // a test whose real subject is "the query did not wait for the gate".
      const coldResults = await engine.search('navigate the browser to a url', 5);

      expect(coldResults.length).toBeGreaterThan(0);
      expect(coldResults[0]!.name).toBe('page_navigate');
      expect(state.embedBatchCalls).toBeGreaterThan(0); // bootstrap was kicked
      expect(state.embed).not.toHaveBeenCalled(); // this query did not embed

      // Let the background bootstrap land.
      state.releaseBootstrap?.();
      await engine.waitForEmbeddings();

      // Same query, warm: the vector signal now participates.
      //
      // "participates" is asserted through the pipeline's OWN observable
      // signal — the `outcome` it writes on search_queries_total — not through
      // `embed()` having been called. A fusion path that computes embeddings
      // and then discards their scores would satisfy the weaker claim, because
      // `page_navigate` is already first lexically: the test would pass while
      // measuring nothing. `full_path_vector` is emitted only when the vector
      // ranking actually fed the result.
      searchOutcomes.length = 0;
      const warmResults = await engine.search('navigate the browser to a url', 5);
      expect(state.embed).toHaveBeenCalled();
      expect(searchOutcomes).toEqual(['full_path_vector']);

      const coldLexical = coldResults.map((r) => r.name);
      const warmLexical = warmResults.map((r) => r.name);
      // The lexical contender set is unchanged; only the fusion differs.
      expect(warmLexical).toEqual(expect.arrayContaining(coldLexical));
      expect(warmResults[0]!.name).toBe('page_navigate');
    },
  );

  it(
    'does not block a query on the bootstrap retry after a failed prewarm',
    { timeout: 15_000 },
    async () => {
      // First call = constructor prewarm that FAILS (sets the retry cooldown).
      // Second call = the retry, gated so we can prove the query does not wait.
      state.embedBatchBehaviors = ['fail', 'gate'];
      const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
      const engine = new ToolSearchEngine();

      // Let the failed constructor prewarm settle so prewarmPromise clears and
      // embeddingRetryAfterMs is the only thing standing between us and a retry.
      await engine.waitForEmbeddings();
      expect(state.embedBatchCalls).toBe(1);

      // Cooldown is zero (see constants mock), so this query must re-enter
      // ensureToolEmbeddings(). A blocking regression would await the gated
      // embedBatch; the search must resolve before we release that gate.
      const results = await engine.search('navigate the browser to a url', 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.name).toBe('page_navigate');
      // The retry was kicked in the background but NOT awaited on the query
      // path. waitFor tolerates the async disk-cache load before embedBatch.
      await vi.waitFor(() => expect(state.embedBatchCalls).toBe(2));
      expect(state.embed).not.toHaveBeenCalled();

      // Release the gated retry so no pending promise outlives the test.
      state.releaseBootstrap?.();
      await engine.waitForEmbeddings();
    },
  );
});
