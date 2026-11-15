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

const state = vi.hoisted(() => ({
  allTools: [] as Tool[],
  embedBatchCalls: 0,
  /** Resolved by the test to release the in-flight bootstrap. */
  releaseBootstrap: null as null | (() => void),
  embed: vi.fn(async (_text: string) => new Float32Array([1, 0, 0])),
}));

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
      // Gate the bootstrap so the test controls when it lands.
      await new Promise<void>((resolve) => {
        state.releaseBootstrap = resolve;
      });
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
      // without the bootstrap being released — the assertion is that this
      // resolves at all (a blocking implementation hangs until the release).
      const started = Date.now();
      const coldResults = await engine.search('navigate the browser to a url', 5);
      const coldElapsed = Date.now() - started;

      expect(coldResults.length).toBeGreaterThan(0);
      expect(coldResults[0]!.name).toBe('page_navigate');
      expect(coldElapsed).toBeLessThan(2_000);
      expect(state.embedBatchCalls).toBeGreaterThan(0); // bootstrap was kicked
      expect(state.embed).not.toHaveBeenCalled(); // this query did not embed

      // Let the background bootstrap land.
      state.releaseBootstrap?.();
      await engine.waitForEmbeddings();

      // Same query, warm: the vector signal now participates.
      const warmResults = await engine.search('navigate the browser to a url', 5);
      expect(state.embed).toHaveBeenCalled();
      expect(warmResults[0]!.name).toBe('page_navigate');
    },
  );
});
