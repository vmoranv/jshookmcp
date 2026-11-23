/**
 * Tests for search-tracker snapshot registration.
 *
 * The SearchQualityTracker implements the
 * SnapshotSource contract, but they live inside the lazily-built
 * ToolSearchEngine, so wiring them into the RuntimeSnapshotScheduler happens
 * at engine-construction time via registerSearchSnapshotSources
 * (src/server/search/snapshotRegistration.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import {
  registerSearchSnapshotSources,
  registerSearchSnapshotSourcesFromCtx,
} from '@server/search/snapshotRegistration';
import {
  RuntimeSnapshotScheduler,
  getStateDir,
} from '@server/persistence/RuntimeSnapshotScheduler';
import type { ToolSearchEngine } from '@server/search/ToolSearchEngine';

function fakeEngine(trackers: { quality?: unknown } = {}): unknown {
  return {
    getSearchQualityTracker: () => trackers.quality ?? { name: 'quality' },
  };
}

const state = vi.hoisted(() => ({
  engine: {} as ToolSearchEngine,
}));

// getSearchEngine is mocked to return a real engine instance built by each
// test; the handlers then exercise the real registration path.
vi.mock('@server/MCPServer.search.helpers', () => ({
  getSearchEngine: async () => state.engine,
  getActiveToolNames: () => new Set<string>(),
  getVisibleDomainsForTier: () => new Set<string>(),
  getBaseTier: () => 'search',
}));

vi.mock('@server/domains/shared/response', () => ({
  asTextResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
}));

vi.mock('@server/ToolRouter', () => ({
  describeTool: () => ({ name: 'x', inputSchema: {} }),
  generateExampleArgs: () => ({}),
}));

vi.mock('@server/MCPServer.search.handlers.activate', () => ({
  activateToolNames: async () => ({ activated: [], alreadyActive: [], notFound: [] }),
  notifyToolListChanged: async () => undefined,
}));

vi.mock('@src/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/constants')>()),
  SEARCH_AUTO_ACTIVATE_DOMAINS: false,
  ACTIVATION_TTL_MINUTES: 30,
}));

import { handleSearchTools } from '@server/MCPServer.search.handlers.search';

describe('registerSearchSnapshotSources', () => {
  it('registers the quality tracker in the state dir', async () => {
    const registerAsync = vi.fn(async () => undefined);
    const scheduler = { registerAsync } as unknown as RuntimeSnapshotScheduler;

    const registered = await registerSearchSnapshotSources(
      scheduler,
      fakeEngine() as never,
      resolve('tmp-state'),
    );

    expect(registered.qualityTracker).toEqual({ name: 'quality' });
    expect(registerAsync).toHaveBeenCalledTimes(1);
    expect(registerAsync).toHaveBeenCalledWith(
      resolve('tmp-state', 'search-quality.json'),
      expect.objectContaining({ name: 'quality' }),
    );
  });

  it('skips gracefully when the ctx has no scheduler or state dir', async () => {
    // A bare ctx (no domain instances) must not throw — registration is a
    // no-op, exactly like a profile whose engine was never built.
    await expect(
      registerSearchSnapshotSourcesFromCtx({} as never, fakeEngine() as never),
    ).resolves.toBeUndefined();
  });

  it('skips gracefully when getDomainInstance is missing entirely', async () => {
    await expect(
      registerSearchSnapshotSourcesFromCtx(
        { getDomainInstance: undefined } as never,
        fakeEngine() as never,
      ),
    ).resolves.toBeUndefined();
  });

  it('is idempotent: a second registration does not grow the scheduler sources', async () => {
    // The engine is cached per ctx, so registerSearchSnapshotSources can run
    // on every search/route/call_tool — the scheduler must not accumulate
    // duplicate entries.
    const scheduler = new RuntimeSnapshotScheduler();

    await registerSearchSnapshotSources(scheduler, fakeEngine() as never, resolve('tmp-state'));
    await registerSearchSnapshotSources(scheduler, fakeEngine() as never, resolve('tmp-state'));

    expect(scheduler.getRegisteredSources()).toHaveLength(1);
    expect(scheduler.getRegisteredSources()?.map((s) => s.filePath)).toEqual([
      resolve('tmp-state', 'search-quality.json'),
    ]);
  });

  it('swaps in rebuilt trackers for the same files (engine reload keeps flushes live)', async () => {
    const scheduler = new RuntimeSnapshotScheduler();

    await registerSearchSnapshotSources(scheduler, fakeEngine() as never, resolve('tmp-state'));
    const rebuilt = fakeEngine({ quality: { name: 'quality-v2' } }) as never;
    await registerSearchSnapshotSources(scheduler, rebuilt, resolve('tmp-state'));

    // Same file, but the registered source is the REBUILT instance.
    const sources = scheduler.getRegisteredSources();
    expect(sources).toHaveLength(1);
    expect(sources?.map((s) => (s.source as unknown as { name: string }).name)).toEqual([
      'quality-v2',
    ]);
  });

  it('works with real tracker instances (SnapshotSource contract shape)', async () => {
    const scheduler = new RuntimeSnapshotScheduler();

    const quality = {
      isPersistDirty: () => false,
      exportSnapshot: () => ({ lastRecordId: null, records: [] }),
      restoreSnapshot: () => undefined,
      markPersisted: () => undefined,
    };
    const registered = await registerSearchSnapshotSources(
      scheduler,
      fakeEngine({ quality }) as never,
      resolve('tmp-state'),
    );

    expect(registered.qualityTracker).toBe(quality);
    expect(scheduler.getRegisteredSources()).toHaveLength(1);
  });
});

describe('handler registration wiring', () => {
  let scheduler: RuntimeSnapshotScheduler;
  let stateDir: string;

  beforeEach(() => {
    scheduler = new RuntimeSnapshotScheduler();
    stateDir = getStateDir();
  });

  it('handleSearchTools registers the engine trackers with the scheduler', async () => {
    // A real engine exposes a real SearchQualityTracker
    // instances; both must end up in the scheduler after one search.
    const engine = {
      search: vi.fn(async () => []),
      getSearchQualityTracker: () => ({
        getEnhancementSuggestions: () => null,
        isPersistDirty: () => false,
      }),
    };
    state.engine = engine as unknown as ToolSearchEngine;

    const ctx = {
      enabledDomains: new Set<string>(),
      mcpLog: { info: vi.fn() },
      getDomainInstance: <T>(key: string) =>
        (key === 'snapshotScheduler'
          ? scheduler
          : key === 'snapshotStateDir'
            ? stateDir
            : undefined) as unknown as T,
    } as any;

    await handleSearchTools(ctx, { query: 'hook fetch' });

    const sources = scheduler.getRegisteredSources();
    expect(sources.map((s) => s.filePath)).toEqual([resolve(stateDir, 'search-quality.json')]);
  });

  it('skips registration gracefully when no scheduler/state dir is configured', async () => {
    // ctx without domain instances (bare test context) must not throw.
    const engine = {
      search: vi.fn(async () => []),
      getSearchQualityTracker: () => ({
        getEnhancementSuggestions: () => null,
        isPersistDirty: () => false,
      }),
    };
    state.engine = engine as unknown as ToolSearchEngine;

    const ctx = {
      enabledDomains: new Set<string>(),
      mcpLog: { info: vi.fn() },
      getDomainInstance: () => undefined,
    } as any;

    await expect(handleSearchTools(ctx, { query: 'hook fetch' })).resolves.toBeDefined();
  });
});
