import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailedDataManager } from './DetailedDataManager.js';
import { TokenBudgetManager } from './TokenBudgetManager.js';

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

    expect(() => manager.recordToolCall('detect_obfuscation', circular, { ok: true })).not.toThrow();
    expect(manager.getStats().toolCallCount).toBe(1);
  });

  it('triggers auto cleanup and clears detailed data cache on high usage', () => {
    const manager = TokenBudgetManager.getInstance();
    const clear = vi.fn();
    vi.spyOn(DetailedDataManager, 'getInstance').mockReturnValue({ clear } as any);

    const largeRef = { detailId: 'detail_x', summary: { size: 262_144 } };
    manager.recordToolCall('network_get_requests', largeRef, largeRef);
    manager.recordToolCall('network_get_requests', largeRef, largeRef);

    expect(clear).toHaveBeenCalled();
    expect(manager.getStats().warnings.some((w) => w >= 90)).toBe(true);
  });

  it('manual cleanup removes old call history and recalculates usage', () => {
    const manager = TokenBudgetManager.getInstance();
    const clear = vi.fn();
    vi.spyOn(DetailedDataManager, 'getInstance').mockReturnValue({ clear } as any);

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

    expect(clear).toHaveBeenCalledTimes(1);
    expect(manager.getStats().toolCallCount).toBe(0);
    expect(manager.getStats().currentUsage).toBe(0);
  });
});

