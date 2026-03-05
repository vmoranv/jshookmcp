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

import { switchToTier, boostProfile, refreshBoostTtl } from '../../src/server/MCPServer.boost.js';

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
      boostTtlMinutes: 0,
      boostLock: Promise.resolve(),
      activatedToolNames: new Set<string>(),
      activatedRegisteredTools: new Map<string, RegisteredTool>(),
      absorbedFromActivated: new Set<string>(),
      extensionToolsByName: new Map(),
      boostedExtensionToolNames: new Set<string>(),
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

describe('switchToTier – search→workflow browser tool scenarios', () => {
  let sdkRegistry: Set<string>;
  /** Track which tools have handlers in the mock router */
  let routerHandlers: Map<string, unknown>;

  function createCtx(overrides?: Partial<MCPServerContext>): MCPServerContext {
    sdkRegistry = new Set<string>();
    routerHandlers = new Map();

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
      boostTtlMinutes: 0,
      boostLock: Promise.resolve(),
      activatedToolNames: new Set<string>(),
      activatedRegisteredTools: new Map<string, RegisteredTool>(),
      absorbedFromActivated: new Set<string>(),
      extensionToolsByName: new Map(),
      boostedExtensionToolNames: new Set<string>(),
      router: {
        addHandlers: vi.fn((handlers: Record<string, unknown>) => {
          for (const [name, handler] of Object.entries(handlers)) {
            routerHandlers.set(name, handler);
          }
        }),
        removeHandler: vi.fn((name: string) => {
          routerHandlers.delete(name);
        }),
        has: vi.fn((name: string) => routerHandlers.has(name)),
      } as any,
      handlerDeps: {} as any,
      server: {
        sendToolListChanged: vi.fn(async () => undefined),
        registerTool: vi.fn(),
      } as any,
      resolveEnabledDomains: vi.fn(() => new Set(['maintenance'])),
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

  it('pure search→workflow boost registers all browser tools', async () => {
    const ctx = createCtx();

    await switchToTier(ctx, 'workflow');

    // All workflow tools except base should be boosted
    const workflowMinusBase = mockToolsByProfile.workflow.filter(
      (t) => !mockToolsByProfile.search.some((b) => b.name === t.name)
    );
    for (const t of workflowMinusBase) {
      expect(ctx.boostedToolNames.has(t.name)).toBe(true);
    }

    // Browser tools should be in the boosted set and have handlers
    expect(ctx.boostedToolNames.has('browser_launch')).toBe(true);
    expect(ctx.boostedToolNames.has('page_navigate')).toBe(true);
    expect(ctx.boostedToolNames.has('page_evaluate')).toBe(true);
    expect(routerHandlers.has('browser_launch')).toBe(true);
    expect(routerHandlers.has('page_navigate')).toBe(true);

    // enabledDomains should include workflow-profile domains
    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(ctx.enabledDomains.has('core')).toBe(true);
  });

  it('search→workflow with prior activated browser tools: absorbed tools keep handlers', async () => {
    const ctx = createCtx();

    // Simulate activate_tools for browser_launch
    sdkRegistry.add('browser_launch');
    const rt = createMockRegisteredTool('browser_launch', sdkRegistry);
    ctx.activatedToolNames.add('browser_launch');
    ctx.activatedRegisteredTools.set('browser_launch', rt);
    routerHandlers.set('browser_launch', async () => 'activated_handler');

    // Boost to workflow
    await switchToTier(ctx, 'workflow');

    // browser_launch should be absorbed from activated → boosted
    expect(ctx.activatedToolNames.has('browser_launch')).toBe(false);
    expect(ctx.boostedToolNames.has('browser_launch')).toBe(true);

    // Its handler should still be in the router (not removed during absorption)
    expect(routerHandlers.has('browser_launch')).toBe(true);

    // Other browser tools (not previously activated) should also be registered
    expect(ctx.boostedToolNames.has('page_navigate')).toBe(true);
    expect(routerHandlers.has('page_navigate')).toBe(true);
  });

  it('FIX: activated browser tools restored after boost→unboost cycle', async () => {
    const ctx = createCtx();

    // Step 1: activate browser_launch
    sdkRegistry.add('browser_launch');
    const rt = createMockRegisteredTool('browser_launch', sdkRegistry);
    ctx.activatedToolNames.add('browser_launch');
    ctx.activatedRegisteredTools.set('browser_launch', rt);
    routerHandlers.set('browser_launch', async () => 'activated_handler');

    // Step 2: boost to workflow (browser_launch gets absorbed)
    await switchToTier(ctx, 'workflow');
    expect(ctx.boostedToolNames.has('browser_launch')).toBe(true);
    expect(ctx.activatedToolNames.has('browser_launch')).toBe(false);
    expect(ctx.absorbedFromActivated.has('browser_launch')).toBe(true);

    // Step 3: unboost back to search (simulates TTL expiry)
    await switchToTier(ctx, 'search');

    // FIXED: browser_launch should be restored to activatedToolNames
    expect(ctx.boostedToolNames.has('browser_launch')).toBe(false);
    expect(ctx.activatedToolNames.has('browser_launch')).toBe(true);
    expect(ctx.activatedRegisteredTools.has('browser_launch')).toBe(true);
    expect(sdkRegistry.has('browser_launch')).toBe(true);
    expect(routerHandlers.has('browser_launch')).toBe(true);
  });

  it('search→workflow boost does NOT absorb extension tools (not in target profile)', async () => {
    const ctx = createCtx();

    // Simulate an extension tool that's activated but NOT in any profile
    sdkRegistry.add('my_extension_tool');
    const rt = createMockRegisteredTool('my_extension_tool', sdkRegistry);
    ctx.activatedToolNames.add('my_extension_tool');
    ctx.activatedRegisteredTools.set('my_extension_tool', rt);
    routerHandlers.set('my_extension_tool', async () => 'extension_handler');

    // Boost to workflow
    await switchToTier(ctx, 'workflow');

    // Extension tool should NOT be absorbed (not in workflow profile)
    expect(ctx.activatedToolNames.has('my_extension_tool')).toBe(true);
    expect(ctx.activatedRegisteredTools.has('my_extension_tool')).toBe(true);

    // But its handler should still be in the router
    expect(routerHandlers.has('my_extension_tool')).toBe(true);
  });

  it('enabledDomains includes browser after search→workflow boost', async () => {
    const ctx = createCtx();
    expect(ctx.enabledDomains.has('browser')).toBe(false);

    await switchToTier(ctx, 'workflow');

    // getProfileDomains mock returns ['browser', 'core', 'network', 'debugger']
    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(ctx.enabledDomains.has('core')).toBe(true);
    expect(ctx.enabledDomains.has('network')).toBe(true);
    expect(ctx.enabledDomains.has('debugger')).toBe(true);
  });

  it('enabledDomains includes activated tool domains after unboost', async () => {
    const ctx = createCtx();

    // activate browser_launch
    sdkRegistry.add('browser_launch');
    const rt = createMockRegisteredTool('browser_launch', sdkRegistry);
    ctx.activatedToolNames.add('browser_launch');
    ctx.activatedRegisteredTools.set('browser_launch', rt);
    routerHandlers.set('browser_launch', async () => 'handler');

    // boost → unboost
    await switchToTier(ctx, 'workflow');
    await switchToTier(ctx, 'search');

    // After unboost, the restored activated tool's domain should be in enabledDomains
    expect(ctx.enabledDomains.has('browser')).toBe(true);
  });
});

describe('refreshBoostTtl', () => {
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
      boostTtlMinutes: 0,
      boostLock: Promise.resolve(),
      activatedToolNames: new Set<string>(),
      activatedRegisteredTools: new Map<string, RegisteredTool>(),
      absorbedFromActivated: new Set<string>(),
      extensionToolsByName: new Map(),
      boostedExtensionToolNames: new Set<string>(),
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

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshBoostTtl resets the TTL timer', () => {
    const ctx = createCtx();
    ctx.currentTier = 'workflow';
    ctx.boostTtlMinutes = 60;
    ctx.boostedToolNames.add('collect_code');

    // Set initial timer
    refreshBoostTtl(ctx);
    expect(ctx.boostTtlTimer).not.toBeNull();

    const firstTimer = ctx.boostTtlTimer;

    // Advance 30 minutes
    vi.advanceTimersByTime(30 * 60 * 1000);

    // Refresh — should create a new timer
    refreshBoostTtl(ctx);
    expect(ctx.boostTtlTimer).not.toBeNull();
    expect(ctx.boostTtlTimer).not.toBe(firstTimer);
  });

  it('refreshBoostTtl does nothing when TTL is disabled', () => {
    const ctx = createCtx();
    ctx.currentTier = 'workflow';
    ctx.boostTtlMinutes = 0;

    refreshBoostTtl(ctx);
    expect(ctx.boostTtlTimer).toBeNull();
  });

  it('refreshBoostTtl does nothing at base tier', () => {
    const ctx = createCtx();
    ctx.boostTtlMinutes = 60;

    refreshBoostTtl(ctx);
    expect(ctx.boostTtlTimer).toBeNull();
  });

  it('boostProfileInner stores ttlMinutes on context', async () => {
    const ctx = createCtx();

    await boostProfile(ctx, 'workflow', 45);

    expect(ctx.boostTtlMinutes).toBe(45);
  });
});

describe('extension tool boost tier management', () => {
  let sdkRegistry: Set<string>;
  let routerHandlers: Map<string, unknown>;

  function createCtx(overrides?: Partial<MCPServerContext>): MCPServerContext {
    sdkRegistry = new Set<string>();
    routerHandlers = new Map<string, unknown>();
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
      boostTtlMinutes: 0,
      boostLock: Promise.resolve(),
      activatedToolNames: new Set<string>(),
      activatedRegisteredTools: new Map<string, RegisteredTool>(),
      absorbedFromActivated: new Set<string>(),
      extensionToolsByName: new Map(),
      boostedExtensionToolNames: new Set<string>(),
      router: {
        addHandlers: vi.fn((handlers: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(handlers)) routerHandlers.set(k, v);
        }),
        removeHandler: vi.fn((name: string) => { routerHandlers.delete(name); }),
      } as any,
      handlerDeps: {} as any,
      server: {
        sendToolListChanged: vi.fn(async () => undefined),
        registerTool: vi.fn(),
      } as any,
      resolveEnabledDomains: vi.fn(() => new Set(['maintenance'])),
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

  it('deferred extension tools are auto-registered when boosting to their tier', async () => {
    const ctx = createCtx();
    const mockHandler = vi.fn();

    // Simulate a deferred extension tool with boostTier=workflow
    ctx.extensionToolsByName.set('ext_tool_a', {
      name: 'ext_tool_a',
      domain: 'external',
      source: 'test-plugin',
      tool: tool('ext_tool_a'),
      boostTier: 'workflow',
      handler: mockHandler,
    });

    // Boost to workflow — should auto-register ext_tool_a
    await switchToTier(ctx, 'workflow');

    expect(ctx.boostedExtensionToolNames.has('ext_tool_a')).toBe(true);
    expect(sdkRegistry.has('ext_tool_a')).toBe(true);
    expect(routerHandlers.has('ext_tool_a')).toBe(true);
  });

  it('boost-registered extension tools are deregistered on unboost', async () => {
    const ctx = createCtx();
    const mockHandler = vi.fn();

    ctx.extensionToolsByName.set('ext_tool_b', {
      name: 'ext_tool_b',
      domain: 'external',
      source: 'test-plugin',
      tool: tool('ext_tool_b'),
      boostTier: 'workflow',
      handler: mockHandler,
    });

    // Boost to workflow, then back to search
    await switchToTier(ctx, 'workflow');
    expect(ctx.boostedExtensionToolNames.has('ext_tool_b')).toBe(true);

    await switchToTier(ctx, 'search');
    expect(ctx.boostedExtensionToolNames.has('ext_tool_b')).toBe(false);
    expect(sdkRegistry.has('ext_tool_b')).toBe(false);
  });

  it('extension tools with boostTier=full are NOT registered at workflow tier', async () => {
    const ctx = createCtx();

    ctx.extensionToolsByName.set('ext_tool_full', {
      name: 'ext_tool_full',
      domain: 'external',
      source: 'test-plugin',
      tool: tool('ext_tool_full'),
      boostTier: 'full',
      handler: vi.fn(),
    });

    await switchToTier(ctx, 'workflow');

    expect(ctx.boostedExtensionToolNames.has('ext_tool_full')).toBe(false);
    expect(sdkRegistry.has('ext_tool_full')).toBe(false);
  });

  it('manually activated extension tools are not re-registered by boost', async () => {
    const ctx = createCtx();

    // Manually activate the extension tool first
    sdkRegistry.add('ext_tool_manual');
    const rt = createMockRegisteredTool('ext_tool_manual', sdkRegistry);
    ctx.activatedToolNames.add('ext_tool_manual');
    ctx.activatedRegisteredTools.set('ext_tool_manual', rt);

    ctx.extensionToolsByName.set('ext_tool_manual', {
      name: 'ext_tool_manual',
      domain: 'external',
      source: 'test-plugin',
      tool: tool('ext_tool_manual'),
      registeredTool: rt,
      boostTier: 'workflow',
      handler: vi.fn(),
    });

    await switchToTier(ctx, 'workflow');

    // Should NOT be in boostedExtensionToolNames (already manually activated)
    expect(ctx.boostedExtensionToolNames.has('ext_tool_manual')).toBe(false);
  });
});
