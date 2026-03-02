/**
 * Tests for boost_profile / switchToTier collision handling.
 *
 * Reproduces the bugs from the debug log:
 *  - "Tool collect_code is already registered" when boosting after activate_tools
 *  - Partial registration leaving tools without handlers (no rollback)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerContext } from '../../src/server/MCPServer.context.js';
import type { ToolProfile } from '../../src/server/ToolCatalog.js';

// Inline mock for the MCP SDK registerTool that enforces uniqueness (real behavior)
function createMockRegisteredTool(name: string, registry: Set<string>): RegisteredTool {
  return {
    remove: () => {
      registry.delete(name);
    },
    update: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
  } as unknown as RegisteredTool;
}

// Tool factory
function tool(name: string): Tool {
  return { name, description: `desc_${name}`, inputSchema: { type: 'object', properties: {} } };
}

// --- Mocks ---

const mockToolsByProfile: Record<string, Tool[]> = {
  search: [tool('search_tools'), tool('activate_tools')],
  minimal: [tool('search_tools'), tool('activate_tools'), tool('browser_launch'), tool('page_navigate'), tool('page_evaluate'), tool('console_execute')],
  workflow: [
    tool('search_tools'), tool('activate_tools'), tool('browser_launch'), tool('page_navigate'),
    tool('page_evaluate'), tool('console_execute'), tool('collect_code'), tool('network_enable'),
    tool('network_get_requests'), tool('debugger_evaluate_global'),
  ],
  full: [
    tool('search_tools'), tool('activate_tools'), tool('browser_launch'), tool('page_navigate'),
    tool('page_evaluate'), tool('console_execute'), tool('collect_code'), tool('network_enable'),
    tool('network_get_requests'), tool('debugger_evaluate_global'),
    tool('page_inject_script'), tool('hook_generate'), tool('process_list'),
  ],
};

vi.mock('../../src/server/ToolCatalog.js', () => ({
  TIER_ORDER: ['search', 'minimal', 'workflow', 'full'],
  TIER_DEFAULT_TTL: { search: 0, minimal: 0, workflow: 60, full: 30, reverse: 30 },
  getTierIndex: (profile: string) => ['search', 'minimal', 'workflow', 'full'].indexOf(profile),
  getToolsForProfile: (profile: string) => mockToolsByProfile[profile] ?? [],
  getProfileDomains: () => ['browser', 'core', 'network', 'debugger'],
  getToolDomain: (name: string) => 'browser',
}));

vi.mock('../../src/server/ToolHandlerMap.js', () => ({
  createToolHandlerMap: (_deps: unknown, names?: ReadonlySet<string>) => {
    const map: Record<string, () => Promise<unknown>> = {};
    if (names) {
      for (const name of names) {
        map[name] = async () => ({ content: [{ type: 'text', text: name }] });
      }
    }
    return map;
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), setLevel: vi.fn() },
}));

import { switchToTier, boostProfile } from '../../src/server/MCPServer.boost.js';

describe('switchToTier – activate_tools collision', () => {
  /** Simulates real MCP SDK: tracks registered tool names, throws on duplicate. */
  let sdkRegistry: Set<string>;

  function createCtx(overrides?: Partial<MCPServerContext>): MCPServerContext {
    sdkRegistry = new Set<string>();

    const baseTier: ToolProfile = 'search';
    const baseTools = mockToolsByProfile.search;
    for (const t of baseTools) sdkRegistry.add(t.name);

    return {
      baseTier,
      currentTier: baseTier,
      selectedTools: baseTools,
      enabledDomains: new Set(['maintenance']),
      boostedToolNames: new Set<string>(),
      boostedRegisteredTools: new Map<string, RegisteredTool>(),
      boostHistory: [],
      boostTtlTimer: null,
      boostLock: Promise.resolve(),
      activatedToolNames: new Set<string>(),
      activatedRegisteredTools: new Map<string, RegisteredTool>(),
      router: {
        addHandlers: vi.fn(),
        removeHandler: vi.fn(),
      } as any,
      handlerDeps: {} as any,
      server: {
        sendToolListChanged: vi.fn(async () => undefined),
        registerTool: vi.fn(),
      } as any,
      resolveEnabledDomains: vi.fn(() => new Set(['maintenance'])),
      // Real registerSingleTool that enforces SDK uniqueness
      registerSingleTool: vi.fn((toolDef: Tool) => {
        if (sdkRegistry.has(toolDef.name)) {
          throw new Error(`Tool ${toolDef.name} is already registered`);
        }
        sdkRegistry.add(toolDef.name);
        return createMockRegisteredTool(toolDef.name, sdkRegistry);
      }),
      ...overrides,
    } as unknown as MCPServerContext;
  }

  it('reproduces original bug: boost fails when activated tools conflict (before fix)', async () => {
    // Scenario from debug log:
    // 1. User at "search" tier
    // 2. activate_tools: collect_code, browser_launch (individually activated)
    // 3. boost_profile(target: "full") -> should NOT throw

    const ctx = createCtx();

    // Simulate activate_tools adding collect_code and browser_launch
    for (const name of ['collect_code', 'browser_launch']) {
      sdkRegistry.add(name);
      const rt = createMockRegisteredTool(name, sdkRegistry);
      ctx.activatedToolNames.add(name);
      ctx.activatedRegisteredTools.set(name, rt);
    }

    // Before fix, this would throw "Tool collect_code is already registered"
    // After fix, it should succeed
    await expect(switchToTier(ctx, 'full')).resolves.not.toThrow();
  });

  it('absorbs activated tools into boost set on tier switch', async () => {
    const ctx = createCtx();

    // activate collect_code individually
    sdkRegistry.add('collect_code');
    const rt = createMockRegisteredTool('collect_code', sdkRegistry);
    ctx.activatedToolNames.add('collect_code');
    ctx.activatedRegisteredTools.set('collect_code', rt);

    await switchToTier(ctx, 'full');

    // collect_code should have moved from activated -> boosted
    expect(ctx.activatedToolNames.has('collect_code')).toBe(false);
    expect(ctx.activatedRegisteredTools.has('collect_code')).toBe(false);
    expect(ctx.boostedToolNames.has('collect_code')).toBe(true);
    expect(ctx.boostedRegisteredTools.has('collect_code')).toBe(true);
  });

  it('registers all non-conflicting tools from target tier', async () => {
    const ctx = createCtx();

    // activate collect_code individually (1 conflicting tool)
    sdkRegistry.add('collect_code');
    const rt = createMockRegisteredTool('collect_code', sdkRegistry);
    ctx.activatedToolNames.add('collect_code');
    ctx.activatedRegisteredTools.set('collect_code', rt);

    await switchToTier(ctx, 'full');

    // All full-tier tools (except base tools) should be in boosted set
    const fullMinusBase = mockToolsByProfile.full.filter(
      (t) => !mockToolsByProfile.search.some((b) => b.name === t.name)
    );
    for (const t of fullMinusBase) {
      expect(ctx.boostedToolNames.has(t.name)).toBe(true);
    }
  });

  it('rolls back on unexpected registration failure', async () => {
    const ctx = createCtx();
    let callCount = 0;

    // Override registerSingleTool to fail after 3 successful registrations
    (ctx as any).registerSingleTool = vi.fn((toolDef: Tool) => {
      callCount++;
      if (callCount > 3) {
        throw new Error(`Simulated failure at tool ${toolDef.name}`);
      }
      sdkRegistry.add(toolDef.name);
      return createMockRegisteredTool(toolDef.name, sdkRegistry);
    });

    await expect(switchToTier(ctx, 'full')).rejects.toThrow('Simulated failure');

    // After rollback: no tools should remain in boosted sets
    expect(ctx.boostedToolNames.size).toBe(0);
    expect(ctx.boostedRegisteredTools.size).toBe(0);

    // The 3 successfully registered tools should have been removed from SDK registry
    // (only the base tools should remain)
    for (const name of sdkRegistry) {
      const isBase = mockToolsByProfile.search.some((t) => t.name === name);
      expect(isBase).toBe(true);
    }
  });

  it('handlers are NOT added when registration fails (no orphaned tools)', async () => {
    const ctx = createCtx();
    let callCount = 0;

    (ctx as any).registerSingleTool = vi.fn((toolDef: Tool) => {
      callCount++;
      if (callCount > 2) throw new Error('boom');
      sdkRegistry.add(toolDef.name);
      return createMockRegisteredTool(toolDef.name, sdkRegistry);
    });

    await expect(switchToTier(ctx, 'full')).rejects.toThrow('boom');

    // router.addHandlers should NOT have been called (handlers are added after the loop)
    expect(ctx.router.addHandlers).not.toHaveBeenCalled();
  });

  it('absorbed activated tools are restored on rollback', async () => {
    const ctx = createCtx();

    // activate collect_code
    sdkRegistry.add('collect_code');
    const rt = createMockRegisteredTool('collect_code', sdkRegistry);
    ctx.activatedToolNames.add('collect_code');
    ctx.activatedRegisteredTools.set('collect_code', rt);

    let callCount = 0;
    const origRegister = ctx.registerSingleTool.bind(ctx);
    (ctx as any).registerSingleTool = vi.fn((toolDef: Tool) => {
      callCount++;
      // Fail after a few successful registrations
      if (callCount > 2) throw new Error('late failure');
      sdkRegistry.add(toolDef.name);
      return createMockRegisteredTool(toolDef.name, sdkRegistry);
    });

    await expect(switchToTier(ctx, 'full')).rejects.toThrow('late failure');

    // collect_code should be restored back to activated set
    expect(ctx.activatedToolNames.has('collect_code')).toBe(true);
    expect(ctx.boostedToolNames.has('collect_code')).toBe(false);
  });

  it('clean boost with no activated tools works normally', async () => {
    const ctx = createCtx();

    await switchToTier(ctx, 'full');

    const fullMinusBase = mockToolsByProfile.full.filter(
      (t) => !mockToolsByProfile.search.some((b) => b.name === t.name)
    );
    expect(ctx.boostedToolNames.size).toBe(fullMinusBase.length);
    expect(ctx.router.addHandlers).toHaveBeenCalledOnce();
  });

  it('switching to base tier clears all boosted tools', async () => {
    const ctx = createCtx();

    // First boost to full
    await switchToTier(ctx, 'full');
    expect(ctx.boostedToolNames.size).toBeGreaterThan(0);

    // Then switch back to base
    await switchToTier(ctx, 'search');
    expect(ctx.boostedToolNames.size).toBe(0);
    expect(ctx.boostedRegisteredTools.size).toBe(0);
  });
});
