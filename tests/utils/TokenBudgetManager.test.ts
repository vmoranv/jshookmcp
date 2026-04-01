import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBudgetManager } from '@utils/TokenBudgetManager';

describe('TokenBudgetManager', () => {
  beforeEach(() => {
    const manager = TokenBudgetManager.getInstance();
    manager.reset();
    manager.setTrackingEnabled(true);
    vi.restoreAllMocks();
  });

  it('returns singleton instance', () => {
    const a = TokenBudgetManager.getInstance();
    const b = TokenBudgetManager.getInstance();
    expect(a).toBe(b);
  });

  it('supports direct construction (DI pattern)', () => {
    const a = new TokenBudgetManager();
    const b = new TokenBudgetManager();
    expect(a).not.toBe(b);
  });

  it('records tool calls and aggregates stats', () => {
    const manager = TokenBudgetManager.getInstance();
    manager.recordToolCall('page_evaluate', { x: 1 }, { ok: true });
    manager.recordToolCall('page_evaluate', { x: 2 }, { ok: true });

    const stats = manager.getStats();
    expect(stats.toolCallCount).toBe(2);
    expect(stats.currentUsage).toBeGreaterThan(0);
    expect(stats.topTools[0]?.tool).toBe('page_evaluate');
  });

  it('does not track when tracking is disabled', () => {
    const manager = TokenBudgetManager.getInstance();
    manager.setTrackingEnabled(false);
    manager.recordToolCall('collect_code', { x: 1 }, { y: 2 });

    const stats = manager.getStats();
    expect(stats.toolCallCount).toBe(0);
    expect(stats.currentUsage).toBe(0);
  });

  it('handles circular structures without throwing', () => {
    const manager = TokenBudgetManager.getInstance();
    const circular: Record<string, unknown> = { name: 'root' };
    circular.self = circular;

    expect(() =>
      manager.recordToolCall('detect_obfuscation', circular, { ok: true }),
    ).not.toThrow();
    expect(manager.getStats().toolCallCount).toBe(1);
  });

  it('triggers auto cleanup via external callback on high usage', () => {
    const manager = TokenBudgetManager.getInstance();
    const cleanupFn = vi.fn();
    manager.setExternalCleanup(cleanupFn);

    const largeRef = { detailId: 'detail_x', summary: { size: 262_144 } };
    manager.recordToolCall('network_get_requests', largeRef, largeRef);
    manager.recordToolCall('network_get_requests', largeRef, largeRef);

    expect(cleanupFn).toHaveBeenCalled();
    expect(manager.getStats().warnings.some((w) => w >= 90)).toBe(true);
  });

  it('manual cleanup removes old call history and recalculates usage', () => {
    const manager = TokenBudgetManager.getInstance();
    const cleanupFn = vi.fn();
    manager.setExternalCleanup(cleanupFn);

    const now = Date.now();
    (manager as any).toolCallHistory = [
      {
        toolName: 'old_call',
        timestamp: now - 10 * 60 * 1000,
        requestSize: 100,
        responseSize: 100,
        estimatedTokens: 50,
        cumulativeTokens: 50,
      },
    ];
    (manager as any).currentUsage = 50;

    manager.manualCleanup();

    expect(cleanupFn).toHaveBeenCalledTimes(1);
    expect(manager.getStats().toolCallCount).toBe(0);
    expect(manager.getStats().currentUsage).toBe(0);
  });

  it('handles errors gracefully in recordToolCall', () => {
    const manager = TokenBudgetManager.getInstance();
    const toxic: Record<string, unknown> = { detailId: 'x' };
    Object.defineProperty(toxic, 'summary', {
      get() {
        throw new Error('toxic');
      },
    });

    expect(() => manager.recordToolCall('test', toxic, null)).not.toThrow();
  });

  it('triggers mcp envelope fallback branches', () => {
    const manager = TokenBudgetManager.getInstance();
    manager.recordToolCall('test', null, null);
    manager.recordToolCall('test', { content: null }, null);
    manager.recordToolCall('test', { content: [] }, null);
    manager.recordToolCall('test', { content: ['string'] }, null);
    manager.recordToolCall('test', { content: [{ type: 'image' }] }, null);
  });

  it('handles extreme depths and non-records in normalization', () => {
    const manager = TokenBudgetManager.getInstance();
    const bigString = 'x'.repeat(2500);

    manager.recordToolCall('test', [[[[[1]]]]], null);
    manager.recordToolCall('test', { a: { b: { c: { d: { e: 1 } } } } }, null);
    manager.recordToolCall('test', BigInt(123), Symbol('test'));
    manager.recordToolCall('test', () => {}, null);
    manager.recordToolCall('test', new Error('test error'), null);
    manager.recordToolCall('test', Buffer.from('test'), null);
    manager.recordToolCall('test', bigString, null);

    // Simulate oversized error stack
    const hugeError = new Error('huge');
    hugeError.stack = bigString;
    manager.recordToolCall('test', hugeError, null);

    // Test Detailed summary with invalid summary type
    manager.recordToolCall('test', { detailId: 'x', summary: 'invalid' }, null);
    manager.recordToolCall('test', { detailId: 'x', summary: { size: 'NaN' } }, null);

    // Test undefined serialization (hits !serialized fallback)
    manager.recordToolCall('test', undefined, undefined);
  });

  it('hits outer catch block when internal operations throw', () => {
    const manager = TokenBudgetManager.getInstance();
    const loggerMock = vi.spyOn(manager as any, 'checkWarnings').mockImplementationOnce(() => {
      throw new Error('Forced internal error');
    });

    manager.recordToolCall('test', { valid: true }, null);
    expect(loggerMock).toHaveBeenCalled();
  });
});
