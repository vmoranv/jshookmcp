import { describe, expect, it } from 'vitest';
import { PredictiveBooster } from '@server/activation/PredictiveBooster';

describe('activation/PredictiveBooster', () => {
  it('builds transition table from recorded calls', () => {
    const booster = new PredictiveBooster();

    booster.recordCall('page_navigate');
    booster.recordCall('page_click');
    booster.recordCall('page_navigate');
    booster.recordCall('page_click');

    expect(booster.transitionCount).toBeGreaterThan(0);
    expect(booster.historyLength).toBe(4);
  });

  it('predicts next tools above confidence threshold', () => {
    const booster = new PredictiveBooster(50, 0.3);

    // Build a strong pattern: navigate → click (100% transition)
    for (let i = 0; i < 10; i++) {
      booster.recordCall('page_navigate');
      booster.recordCall('page_click');
    }

    const predictions = booster.predictNext('page_navigate');
    expect(predictions).toContain('page_click');
  });

  it('does not predict below confidence threshold', () => {
    const booster = new PredictiveBooster(50, 0.5);

    // Build a mixed pattern
    booster.recordCall('page_navigate');
    booster.recordCall('page_click');
    booster.recordCall('page_navigate');
    booster.recordCall('debug_pause');
    booster.recordCall('page_navigate');
    booster.recordCall('page_click');

    // page_navigate → page_click is 2/3 ≈ 0.67 (above 0.5)
    // page_navigate → debug_pause is 1/3 ≈ 0.33 (below 0.5)
    const predictions = booster.predictNext('page_navigate');
    expect(predictions).toContain('page_click');
    expect(predictions).not.toContain('debug_pause');
  });

  it('sliding window capped at maxHistory', () => {
    const booster = new PredictiveBooster(5);

    for (let i = 0; i < 10; i++) {
      booster.recordCall(`tool_${i}`);
    }

    expect(booster.historyLength).toBe(5);
  });

  it('returns empty for unknown tools', () => {
    const booster = new PredictiveBooster();

    booster.recordCall('page_navigate');
    booster.recordCall('page_click');

    const predictions = booster.predictNext('unknown_tool');
    expect(predictions).toEqual([]);
  });

  it('predictNextDomains returns domains from predicted tools', () => {
    const booster = new PredictiveBooster(50, 0.3);

    for (let i = 0; i < 10; i++) {
      booster.recordCall('page_navigate');
      booster.recordCall('debug_pause');
    }

    const domains = booster.predictNextDomains('page_navigate', (name) => {
      if (name.startsWith('debug_')) return 'debugger';
      if (name.startsWith('page_')) return 'browser';
      return null;
    });

    expect(domains).toContain('debugger');
  });

  it('reset clears all state', () => {
    const booster = new PredictiveBooster();

    booster.recordCall('page_navigate');
    booster.recordCall('page_click');
    expect(booster.historyLength).toBe(2);

    booster.reset();
    expect(booster.historyLength).toBe(0);
    expect(booster.transitionCount).toBe(0);
  });

  it('predictNext returns empty if total transitions is 0', () => {
    const booster = new PredictiveBooster();
    booster.recordCall('A');
    booster.recordCall('B');
    // Force total to 0 to simulate weird internal state
    (booster as any).transitions.get('A').set('B', 0);
    expect(booster.predictNext('A')).toEqual([]);
  });

  it('predictNextDomains skips mapped tools that return null domains', () => {
    const booster = new PredictiveBooster(50, 0.3);
    for (let i = 0; i < 10; i++) {
      booster.recordCall('page_navigate');
      booster.recordCall('unknown_tool');
    }
    const domains = booster.predictNextDomains('page_navigate', () => null);
    expect(domains).toEqual([]);
  });
});
