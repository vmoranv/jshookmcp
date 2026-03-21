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
    const pruner = new AutoPruner(
      eventBus,
      new Set(['browser']), // browser is base tier
      (d) => prunedDomains.push(d),
      { checkIntervalMs: 50, autoActivatedInactivityMs: 10 }
    );

    pruner.recordActivity('browser');

    // Simulate time passing by directly calling the check
    // Use fake timers
    vi.useFakeTimers();
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
});
