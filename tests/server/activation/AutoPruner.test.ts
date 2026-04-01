import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type ServerEventMap } from '@server/EventBus';
import { AutoPruner } from '@server/activation/AutoPruner';

describe('activation/AutoPruner', () => {
  let eventBus: EventBus<ServerEventMap>;
  let prunedDomains: string[];

  beforeEach(() => {
    prunedDomains = [];
    eventBus = new EventBus<ServerEventMap>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tracks domain activity timestamps', () => {
    const pruner = new AutoPruner(eventBus, new Set(['browser']), (d) => prunedDomains.push(d));

    pruner.recordActivity('debugger');
    expect(pruner.getLastActivity('debugger')).toBeGreaterThan(0);

    pruner.dispose();
  });

  it('does not prune base tier domains', () => {
    vi.useFakeTimers();
    const pruner = new AutoPruner(
      eventBus,
      new Set(['browser']), // browser is base tier
      (d) => prunedDomains.push(d),
      { checkIntervalMs: 50, autoActivatedInactivityMs: 10 },
    );

    pruner.recordActivity('browser');

    // Use fake timers
    vi.advanceTimersByTime(100);

    // browser should NOT be pruned (it's base tier)
    expect(prunedDomains).not.toContain('browser');

    vi.useRealTimers();
    pruner.dispose();
  });

  it('marks domains as auto-activated with shorter threshold', () => {
    const pruner = new AutoPruner(eventBus, new Set(), (d) => prunedDomains.push(d));

    pruner.markAutoActivated('network');
    expect(pruner.isAutoActivated('network')).toBe(true);
    expect(pruner.getLastActivity('network')).toBeGreaterThan(0);

    pruner.dispose();
  });

  it('dispose clears interval timer and state', () => {
    const pruner = new AutoPruner(eventBus, new Set(), (d) => prunedDomains.push(d));

    pruner.recordActivity('debugger');
    pruner.markAutoActivated('network');

    pruner.dispose();

    expect(pruner.getLastActivity('debugger')).toBeUndefined();
    expect(pruner.isAutoActivated('network')).toBe(false);
  });

  it('actually prunes domains when threshold is reached', async () => {
    vi.useFakeTimers();
    let prunedEventCalled = false;
    eventBus.on('activation:domain_pruned', () => {
      prunedEventCalled = true;
    });

    const pruner = new AutoPruner(eventBus, new Set(['browser']), (d) => prunedDomains.push(d), {
      checkIntervalMs: 50,
      manualActivatedInactivityMs: 200,
      autoActivatedInactivityMs: 100,
    });

    // Manual activated domain - 200ms threshold
    pruner.recordActivity('network');
    // Auto activated domain - 100ms threshold
    pruner.markAutoActivated('debugger');

    // Advance 150ms -> only debugger should prune
    vi.advanceTimersByTime(150);

    expect(prunedDomains).toContain('debugger');
    expect(prunedDomains).not.toContain('network');
    expect(prunedEventCalled).toBe(true);

    // Advance another 100ms -> network should prune
    vi.advanceTimersByTime(100);
    expect(prunedDomains).toContain('network');

    vi.useRealTimers();
    pruner.dispose();
  });

  it('safely handles environments missing timer unref', () => {
    const originalSetInterval = global.setInterval;
    vi.spyOn(global, 'setInterval').mockImplementation(((cb: any, ms: any) => {
      const timerId = originalSetInterval(cb, ms);
      return { id: timerId } as any; // Return fake timer without unref
    }) as any);

    const pruner = new AutoPruner(eventBus, new Set(), () => {});
    expect(pruner).toBeDefined();

    const timerObj = (pruner as any).checkTimer;
    expect(timerObj.unref).toBeUndefined();

    // Need to clear the actual interval created
    clearInterval(timerObj.id);
    vi.restoreAllMocks();
  });

  it('safely handles double dispose', () => {
    const pruner = new AutoPruner(eventBus, new Set(), () => {});
    pruner.dispose();
    pruner.dispose(); // hits if (!this.checkTimer) branch
  });
});
