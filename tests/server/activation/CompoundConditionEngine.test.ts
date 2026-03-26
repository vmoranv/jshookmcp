import { describe, expect, it } from 'vitest';
import {
  CompoundConditionEngine,
  type ConditionState,
} from '@server/activation/CompoundConditionEngine';

function makeState(overrides: Partial<ConditionState> = {}): ConditionState {
  return {
    platform: 'darwin',
    activeDomains: new Set<string>(),
    eventHistory: [],
    recentToolCalls: [],
    ...overrides,
  };
}

describe('activation/CompoundConditionEngine', () => {
  it('evaluates AND logic — all conditions must be true', () => {
    const engine = new CompoundConditionEngine([
      {
        id: 'test-and',
        name: 'Test AND',
        conditions: [
          { type: 'platform', value: 'darwin' },
          { type: 'domain_active', domain: 'browser' },
        ],
        boostDomains: ['wasm'],
        priority: 10,
      },
    ]);

    // Both conditions met
    const state = makeState({
      platform: 'darwin',
      activeDomains: new Set(['browser']),
    });
    expect(engine.evaluate(state)).toContain('wasm');
  });

  it('returns empty for unmet conditions', () => {
    const engine = new CompoundConditionEngine([
      {
        id: 'test-unmet',
        name: 'Test Unmet',
        conditions: [
          { type: 'platform', value: 'win32' },
          { type: 'domain_active', domain: 'browser' },
        ],
        boostDomains: ['debugger'],
        priority: 10,
      },
    ]);

    // Platform is darwin, not win32 — condition fails
    const state = makeState({
      platform: 'darwin',
      activeDomains: new Set(['browser']),
    });
    expect(engine.evaluate(state)).toEqual([]);
  });

  it('platform condition matches process.platform', () => {
    const engine = new CompoundConditionEngine([
      {
        id: 'macos-only',
        name: 'macOS only',
        conditions: [{ type: 'platform', value: 'darwin' }],
        boostDomains: ['platform'],
        priority: 5,
      },
    ]);

    expect(engine.evaluate(makeState({ platform: 'darwin' }))).toContain('platform');
    expect(engine.evaluate(makeState({ platform: 'win32' }))).toEqual([]);
  });

  it('domain_active condition checks active domains', () => {
    const engine = new CompoundConditionEngine([
      {
        id: 'needs-network',
        name: 'Needs network',
        conditions: [{ type: 'domain_active', domain: 'network' }],
        boostDomains: ['hooks'],
        priority: 5,
      },
    ]);

    expect(engine.evaluate(makeState({ activeDomains: new Set(['network']) }))).toContain('hooks');
    expect(engine.evaluate(makeState({ activeDomains: new Set(['browser']) }))).toEqual([]);
  });

  it('event_count condition counts events in window', () => {
    const engine = new CompoundConditionEngine([
      {
        id: 'many-calls',
        name: 'Many tool calls',
        conditions: [{ type: 'event_count', event: 'tool:called', minCount: 3, windowMs: 60_000 }],
        boostDomains: ['workflow'],
        priority: 5,
      },
    ]);

    const now = Date.now();
    const events = [
      { event: 'tool:called', timestamp: now - 1000 },
      { event: 'tool:called', timestamp: now - 2000 },
      { event: 'tool:called', timestamp: now - 3000 },
    ];

    expect(engine.evaluate(makeState({ eventHistory: events }))).toContain('workflow');
    expect(engine.evaluate(makeState({ eventHistory: events.slice(0, 2) }))).toEqual([]);
  });

  it('deduplicates boost domains across conditions', () => {
    const engine = new CompoundConditionEngine([
      {
        id: 'rule-1',
        name: 'Rule 1',
        conditions: [{ type: 'platform', value: 'darwin' }],
        boostDomains: ['wasm', 'transform'],
        priority: 10,
      },
      {
        id: 'rule-2',
        name: 'Rule 2',
        conditions: [{ type: 'platform', value: 'darwin' }],
        boostDomains: ['wasm', 'hooks'],
        priority: 5,
      },
    ]);

    const result = engine.evaluate(makeState());
    expect(result).toContain('wasm');
    expect(result).toContain('transform');
    expect(result).toContain('hooks');
    // wasm should appear only once
    expect(result.filter((d) => d === 'wasm').length).toBe(1);
  });

  it('conditionCount returns total conditions', () => {
    const engine = new CompoundConditionEngine();
    // Should have default conditions (3)
    expect(engine.conditionCount).toBeGreaterThanOrEqual(3);
  });
});
