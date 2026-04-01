import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBudgetManager } from '@utils/TokenBudgetManager';
import { logger } from '@utils/logger';

describe('TokenBudgetManager Extra Coverage', () => {
  let manager: TokenBudgetManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = TokenBudgetManager.getInstance();
    manager.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('normalizeForSizeEstimate handles various types', () => {
    const data = {
      bigint: BigInt(123),
      symbol: Symbol('sym'),
      func: () => {},
      error: new Error('test error'),
      buffer: Buffer.from('hello'),
    };
    // Access private method
    const normalized = (manager as any).normalizeForSizeEstimate(data, 0, new WeakSet());
    expect(normalized.bigint).toBe('123');
    expect(normalized.symbol).toContain('Symbol(sym)');
    expect(normalized.func).toBe('[Function]');
    expect(normalized.error.message).toBe('test error');
    expect(normalized.buffer).toBe('[Buffer:5]');
  });

  it('normalizeForSizeEstimate handles depth limits', () => {
    const deepObj = { a: { b: { c: { d: { e: 'f' } } } } };
    const deepArr = [[[[['too-deep']]]]];

    const normObj = (manager as any).normalizeForSizeEstimate(deepObj, 0, new WeakSet());
    const normArr = (manager as any).normalizeForSizeEstimate(deepArr, 0, new WeakSet());

    expect(normObj.a.b.c.d).toBe('[Object]');
    expect(normArr[0][0][0][0]).toBe('[Array:1]');
  });

  it('normalizeForSizeEstimate handles truncation', () => {
    const longArr = Array.from({ length: 60 }, (_, i) => i);
    const wideObj: any = {};
    for (let i = 0; i < 60; i++) wideObj[`k${i}`] = i;

    const normArr = (manager as any).normalizeForSizeEstimate(longArr, 0, new WeakSet());
    const normObj = (manager as any).normalizeForSizeEstimate(wideObj, 0, new WeakSet());

    expect(normArr.length).toBe(51); // 50 + 1 truncation marker
    expect(normArr[50]).toBe('[truncated:10]');
    expect(normObj.__truncatedKeys).toBe(10);
  });

  it('normalizeForSizeEstimate handles circular references', () => {
    const circ: any = { a: 1 };
    circ.self = circ;
    const norm = (manager as any).normalizeForSizeEstimate(circ, 0, new WeakSet());
    expect(norm.self).toBe('[Circular]');
  });

  it('tryEstimateMcpEnvelope handles edge cases', () => {
    const tryEst = (data: any) => (manager as any).tryEstimateMcpEnvelope(data);

    expect(tryEst(null)).toBeNull();
    expect(tryEst({})).toBeNull();
    expect(tryEst({ content: 'not-array' })).toBeNull();
    expect(tryEst({ content: [] })).toBeNull();
    expect(tryEst({ content: [null] })).toBeNull();
    expect(tryEst({ content: [{ type: 'image' }] })).toBeNull();
    expect(tryEst({ content: [{ type: 'text' }] })).toBeNull(); // missing text string

    const largeText = 'x'.repeat(3000);
    const ok = { content: [{ type: 'text', text: largeText }] };
    expect(tryEst(ok)).toBeLessThan(3000 + 50);

    const err = { content: [{ type: 'text', text: 'fail' }], isError: true };
    expect(tryEst(err)).toBeGreaterThan(42 + 4 + 10);
  });

  it('recordToolCall handles disabled tracking and errors', () => {
    const spy = vi.spyOn(logger, 'debug');
    manager.setTrackingEnabled(false);
    manager.recordToolCall('test', {}, {});
    expect(spy).not.toHaveBeenCalled();

    manager.setTrackingEnabled(true);
    // Trigger catch block in calculateSize via throwing JSON.stringify
    const cyclic: any = {};
    cyclic.self = cyclic;
    // Wait, calculateSize uses normalizeForSizeEstimate which handles circularity.
    // I need something that REALLY crashes calculateSize.
    // calculateSize calls tryEstimateMcpEnvelope first.
    // If I pass something that causes an error in isRecord or similar?
    // isRecord is safe.

    // I'll mock calculateSize to throw
    const originalCalc = (manager as any).calculateSize;
    (manager as any).calculateSize = () => {
      throw new Error('calc failed');
    };
    const errSpy = vi.spyOn(logger, 'error');
    manager.recordToolCall('test', {}, {});
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('record tool call'),
      expect.any(Error),
    );
    (manager as any).calculateSize = originalCalc;
  });

  it('autoCleanup handles external cleanup failure', () => {
    manager.setExternalCleanup(() => {
      throw new Error('cleanup failed');
    });
    const warnSpy = vi.spyOn(logger, 'warn');

    // Force usage > 90%
    (manager as any).currentUsage = 950000; // Assuming 1M MAX_TOKENS
    (manager as any).autoCleanup();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('cleanup callback failed'),
      expect.any(Error),
    );
  });

  it('generateSuggestions provides specific advice', () => {
    // Usage at 96% of 200,000
    (manager as any).currentUsage = 192000;
    // Set toolCallHistory to trigger tool-specific suggestions
    (manager as any).toolCallHistory = [
      { toolName: 'collect_code', estimatedTokens: 80000 },
      { toolName: 'get_script_source', estimatedTokens: 80000 },
    ];

    const stats = manager.getStats();
    const suggs = stats.suggestions;

    expect(suggs.some((s) => s.includes('CRITICAL'))).toBe(true);
    expect(suggs.some((s) => s.includes('collect_code'))).toBe(true);
    expect(suggs.some((s) => s.includes('get_script_source'))).toBe(true);
  });

  it('setTrackingEnabled avoids redundant logs', () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    manager.setTrackingEnabled(true); // already true
    expect(warnSpy).not.toHaveBeenCalled();
    manager.setTrackingEnabled(false);
    expect(warnSpy).toHaveBeenCalled();
  });
});
