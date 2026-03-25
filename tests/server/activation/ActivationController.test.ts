import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type ServerEventMap } from '@server/EventBus';

const state = vi.hoisted(() => ({
  handleActivateDomain: vi.fn(
    async (ctx: { enabledDomains: Set<string> }, args: { domain: string }) => {
      ctx.enabledDomains.add(args.domain);
      return { content: [{ type: 'text', text: '{"success":true}' }] };
    },
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/ToolCatalog', () => ({
  getToolDomain: vi.fn((name: string) => {
    if (name.startsWith('page_')) return 'browser';
    if (name.startsWith('debug_')) return 'debugger';
    if (name.startsWith('memory_')) return 'memory';
    return null;
  }),
  getProfileDomains: vi.fn(() => ['browser']),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/MCPServer.search.handlers.domain', () => ({
  handleActivateDomain: state.handleActivateDomain,
}));

describe('activation/ActivationController', () => {
  let eventBus: EventBus<ServerEventMap>;
  let mockCtx: { enabledDomains: Set<string>; baseTier: string };

  beforeEach(() => {
    vi.resetModules();
    eventBus = new EventBus<ServerEventMap>();
    mockCtx = {
      enabledDomains: new Set<string>(),
      baseTier: 'search',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    state.handleActivateDomain.mockClear();
  });

  it('subscribes to EventBus events on construction', async () => {
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    expect(eventBus.listenerCount('tool:called')).toBe(1);
    expect(eventBus.listenerCount('debugger:breakpoint_hit')).toBe(1);
    expect(eventBus.listenerCount('browser:navigated')).toBe(1);
    expect(eventBus.listenerCount('memory:scan_completed')).toBe(1);

    controller.dispose();
  });

  it('tracks domain activity on tool:called events', async () => {
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    await eventBus.emit('tool:called', {
      toolName: 'page_navigate',
      domain: 'browser',
      timestamp: new Date().toISOString(),
      success: true,
    });

    expect(controller.getLastActivity('browser')).toBeGreaterThan(0);
    controller.dispose();
  });

  it('debounces domain boosts within cooldown period', async () => {
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never, {
      cooldownMs: 30_000,
    });

    // First breakpoint should trigger boost attempt
    await eventBus.emit('debugger:breakpoint_hit', {
      scriptId: '1',
      lineNumber: 10,
      timestamp: new Date().toISOString(),
    });

    const firstBoostTime = controller.getLastBoostTime('debugger');
    expect(firstBoostTime).toBeGreaterThan(0);
    expect(state.handleActivateDomain).toHaveBeenCalledTimes(1);

    // Second rapid breakpoint — boost time should NOT change (debounced)
    await eventBus.emit('debugger:breakpoint_hit', {
      scriptId: '2',
      lineNumber: 20,
      timestamp: new Date().toISOString(),
    });

    expect(controller.getLastBoostTime('debugger')).toBe(firstBoostTime);
    expect(state.handleActivateDomain).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('skips boost if domain is already enabled', async () => {
    mockCtx.enabledDomains.add('debugger');

    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    await eventBus.emit('debugger:breakpoint_hit', {
      scriptId: '1',
      lineNumber: 10,
      timestamp: new Date().toISOString(),
    });

    // No boost time recorded because domain is already enabled
    expect(controller.getLastBoostTime('debugger')).toBeUndefined();
    expect(state.handleActivateDomain).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('dispose cleans up all subscriptions', async () => {
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    expect(eventBus.listenerCount('tool:called')).toBe(1);
    controller.dispose();
    expect(eventBus.listenerCount('tool:called')).toBe(0);
  });

  it('records events in sliding window history', async () => {
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    await eventBus.emit('tool:called', {
      toolName: 'page_click',
      domain: 'browser',
      timestamp: new Date().toISOString(),
      success: true,
    });

    expect(controller.getEventHistory().length).toBe(1);
    expect(controller.getEventHistory()[0]!.event).toBe('tool:called');

    controller.dispose();
  });
});

describe('activation/getPlatformFilteredTools', () => {
  it('returns all tools on Windows', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const { getPlatformFilteredTools } = await import('@server/activation/ActivationController');
    const tools = [
      {
        name: 'pe_headers',
        description: 'PE analysis',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'page_navigate',
        description: 'Navigate',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ];

    const filtered = getPlatformFilteredTools(tools);
    expect(filtered.length).toBe(2);

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('filters Win32-only tools on non-Windows platforms', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    // Need fresh import after changing platform
    vi.resetModules();
    const { getPlatformFilteredTools } = await import('@server/activation/ActivationController');
    const tools = [
      {
        name: 'pe_headers',
        description: 'PE analysis',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'page_navigate',
        description: 'Navigate',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'inject_patch',
        description: 'Inject code',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ];

    const filtered = getPlatformFilteredTools(tools);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.name).toBe('page_navigate');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});
