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

describe('activation/ActivationController – event-driven boost (ACTV-01~04)', () => {
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

  it('emits domain_boosted event when domain boost is triggered (ACTV-02)', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    await eventBus.emit('debugger:breakpoint_hit', {
      scriptId: '1',
      lineNumber: 10,
      timestamp: new Date().toISOString(),
    });

    expect(state.handleActivateDomain).toHaveBeenCalledWith(mockCtx, {
      domain: 'debugger',
      ttlMinutes: 30,
    });
    expect(mockCtx.enabledDomains.has('debugger')).toBe(true);
    expect(emitSpy).toHaveBeenNthCalledWith(
      2,
      'activation:domain_boosted',
      expect.objectContaining({
        domain: 'debugger',
        reason: expect.stringContaining('debugger:breakpoint_hit'),
      }),
    );
    controller.dispose();
  });

  it('debugger:breakpoint_hit triggers debugger domain boost end-to-end (ACTV-03)', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    await eventBus.emit('debugger:breakpoint_hit', {
      scriptId: 'test-script',
      lineNumber: 42,
      timestamp: new Date().toISOString(),
    });

    expect(state.handleActivateDomain).toHaveBeenCalledWith(mockCtx, {
      domain: 'debugger',
      ttlMinutes: 30,
    });
    expect(mockCtx.enabledDomains.has('debugger')).toBe(true);
    expect(emitSpy).toHaveBeenNthCalledWith(
      2,
      'activation:domain_boosted',
      expect.objectContaining({ domain: 'debugger' }),
    );
    controller.dispose();
  });

  it('memory:scan_completed triggers memory domain boost (ACTV-03)', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    await eventBus.emit('memory:scan_completed', {
      scanType: 'exact',
      resultCount: 5,
      timestamp: new Date().toISOString(),
    });

    expect(state.handleActivateDomain).toHaveBeenCalledWith(mockCtx, {
      domain: 'memory',
      ttlMinutes: 30,
    });
    expect(mockCtx.enabledDomains.has('memory')).toBe(true);
    expect(emitSpy).toHaveBeenNthCalledWith(
      2,
      'activation:domain_boosted',
      expect.objectContaining({ domain: 'memory' }),
    );
    controller.dispose();
  });

  it('TTL cleanup clears internal state on dispose (ACTV-04)', async () => {
    const { ActivationController } = await import('@server/activation/ActivationController');
    const controller = new ActivationController(eventBus, mockCtx as never);

    // Trigger a boost
    await eventBus.emit('debugger:breakpoint_hit', {
      scriptId: '1',
      lineNumber: 10,
      timestamp: new Date().toISOString(),
    });

    expect(controller.getLastBoostTime('debugger')).toBeGreaterThan(0);

    // Dispose clears state
    controller.dispose();
    expect(controller.getLastBoostTime('debugger')).toBeUndefined();
  });
});
