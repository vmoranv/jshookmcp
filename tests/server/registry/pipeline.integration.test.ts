/**
 * In-process pipeline integration test — NO registry mocks.
 *
 * Why this exists: the v0.4.5 P0 (search-tier tools discoverable but never
 * activatable) passed 20,562 unit tests because every server-layer test mocks
 * `getRegistrationByName` / `ensureDomainLoaded` / `loadSearchCatalog`, and the
 * real stdio e2e suite is excluded from the default `pnpm test`. This test
 * runs the REAL registry + REAL activate handler in the default `server`
 * vitest project, so a regression in the cross-layer registration cache is
 * caught by `pnpm test` without needing a built dist or a browser.
 *
 * Only pure IO leaves are stubbed (createToolHandlerMap,
 * sendToolListChanged). Everything that decides whether a tool is resolvable
 * stays real: loadSearchCatalog, ensureDomainLoaded, getRegistrationByName,
 * state.ts's shared registration cache.
 */
import { describe, expect, it, vi } from 'vitest';
import { createServerEventBus } from '@server/EventBus';
import type { Tool } from '@modelcontextprotocol/server';

// Stub ONLY the leaf that binds real handlers (needs the whole DI graph) and
// the SDK notification. Neither is allowed to fake "tool found" — the
// registry lookups below are the real implementations.
vi.mock('@server/ToolHandlerMap', () => ({
  createToolHandlerMap: () => ({}),
}));

function makeCtx() {
  const registered: Tool[] = [];
  return {
    selectedTools: [],
    baseTier: 'search' as const,
    config: { mcp: {} },
    activatedToolNames: new Set<string>(),
    activatedRegisteredTools: new Map<string, unknown>(),
    extensionToolsByName: new Map<string, unknown>(),
    enabledDomains: new Set<string>(),
    handlerDeps: {},
    eventBus: createServerEventBus(),
    router: { addHandlers: (_m: Record<string, unknown>) => undefined, has: (_n: string) => false },
    registerSingleTool: (tool: Tool) => {
      registered.push(tool);
      return tool;
    },
    server: { sendToolListChanged: async () => undefined },
    registered,
  };
}

describe('search-tier lazy activation pipeline (in-process, no registry mocks)', () => {
  it('activates a workflow/full-domain tool after initRegistry("search")', async () => {
    // vi.resetModules() requires re-importing the singleton so initRegistry
    // actually runs (a static import could reuse another test's initialized
    // instance). Intentional module-loading boundary — ts-no-dynamic-import
    // exception.
    vi.resetModules();
    const registry = await import('@server/registry/index');
    const { activateToolNames } = await import('@server/MCPServer.search.handlers.activate');
    const { getRegistrationByName } = await import('@server/registry/views');

    // `search` starts with ZERO loaded domains. This is the exact state that
    // exposed the P0: any workflow/full tool must be lazily loaded.
    await registry.initRegistry('search');
    expect([...registry.getAllDomains()]).toEqual([]);

    // Before activation, the tool is in the static catalog but NOT resolvable.
    expect(getRegistrationByName('network_get_status')).toBeUndefined();

    const ctx = makeCtx();
    const result = await activateToolNames(ctx as never, [
      'network_get_status',
      'network_get_stats',
    ]);

    // The P0 symptom was every name landing in notFound with totalDomainTools 0.
    expect(result.notFound).toEqual([]);
    expect(result.activated).toContain('network_get_status');
    expect(result.activated).toContain('network_get_stats');

    // ensureDomainLoaded really registered the domain and its tools are
    // resolvable through the SHARED cache (the exact broken invariant).
    expect([...registry.getAllDomains()]).toContain('network');
    expect(getRegistrationByName('network_get_status')?.tool.name).toBe('network_get_status');
    expect(ctx.registered.map((t) => t.name)).toEqual(['network_get_status', 'network_get_stats']);
  });

  it('lazily activates a full-only domain (wasm) from the search profile', async () => {
    // `wasm` is declared `profiles: ['full']`, so initRegistry('search') loads
    // no part of it. Activation must still be able to pull it in on demand:
    // the startup profile decides what is preloaded, not what call_tool may
    // reach. This is the regression guard for the audit's
    // "Unknown tool: wasm_capabilities" finding — if lazy load stops landing
    // in the shared registration cache, the name lands in notFound again.
    vi.resetModules();
    const registry = await import('@server/registry/index');
    const { activateToolNames } = await import('@server/MCPServer.search.handlers.activate');
    const { getRegistrationByName } = await import('@server/registry/views');

    await registry.initRegistry('search');
    expect([...registry.getAllDomains()]).toEqual([]);

    const ctx = makeCtx();
    const result = await activateToolNames(ctx as never, ['wasm_capabilities', 'wasm_inspect']);

    expect(result.notFound).toEqual([]);
    expect(result.activated).toEqual(expect.arrayContaining(['wasm_capabilities', 'wasm_inspect']));
    expect([...registry.getAllDomains()]).toContain('wasm');
    expect(getRegistrationByName('wasm_inspect')?.tool.name).toBe('wasm_inspect');
    expect(ctx.registered.map((t) => t.name)).toEqual(
      expect.arrayContaining(['wasm_capabilities', 'wasm_inspect']),
    );
  });
});
