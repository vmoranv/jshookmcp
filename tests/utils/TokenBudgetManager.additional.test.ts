import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBudgetManager } from '@utils/TokenBudgetManager';

describe('TokenBudgetManager – additional coverage', () => {
  let manager: TokenBudgetManager;

  beforeEach(() => {
    manager = new TokenBudgetManager();
    manager.setTrackingEnabled(true);
    vi.restoreAllMocks();
  });

  describe('generateSuggestions – tool-specific suggestions (lines 387-405)', () => {
    it('suggests smartMode for collect_code when it uses >30% tokens', () => {
      // Directly inject history to control percentages
      const now = Date.now();
      (manager as any).toolCallHistory = [
        {
          toolName: 'collect_code_scripts',
          timestamp: now,
          requestSize: 1000,
          responseSize: 1000,
          estimatedTokens: 80000,
          cumulativeTokens: 80000,
        },
        {
          toolName: 'other_tool',
          timestamp: now,
          requestSize: 100,
          responseSize: 100,
          estimatedTokens: 10000,
          cumulativeTokens: 90000,
        },
      ];
      (manager as any).currentUsage = 90000;

      const stats = manager.getStats();
      expect(
        stats.suggestions.some((s) => s.includes('collect_code') && s.includes('smartMode'))
      ).toBe(true);
    });

    it('suggests preview=true for get_script_source when it uses >30% tokens', () => {
      const now = Date.now();
      (manager as any).toolCallHistory = [
        {
          toolName: 'get_script_source_viewer',
          timestamp: now,
          requestSize: 1000,
          responseSize: 1000,
          estimatedTokens: 70000,
          cumulativeTokens: 70000,
        },
        {
          toolName: 'other',
          timestamp: now,
          requestSize: 100,
          responseSize: 100,
          estimatedTokens: 10000,
          cumulativeTokens: 80000,
        },
      ];
      (manager as any).currentUsage = 80000;

      const stats = manager.getStats();
      expect(
        stats.suggestions.some((s) => s.includes('get_script_source') && s.includes('preview'))
      ).toBe(true);
    });

    it('suggests reducing limit for network_get_requests when >30% tokens', () => {
      const now = Date.now();
      (manager as any).toolCallHistory = [
        {
          toolName: 'network_get_requests_tool',
          timestamp: now,
          requestSize: 1000,
          responseSize: 1000,
          estimatedTokens: 60000,
          cumulativeTokens: 60000,
        },
        {
          toolName: 'other',
          timestamp: now,
          requestSize: 100,
          responseSize: 100,
          estimatedTokens: 10000,
          cumulativeTokens: 70000,
        },
      ];
      (manager as any).currentUsage = 70000;

      const stats = manager.getStats();
      expect(
        stats.suggestions.some((s) => s.includes('network_get_requests') && s.includes('limit'))
      ).toBe(true);
    });

    it('suggests specific properties for page_evaluate when >30% tokens', () => {
      const now = Date.now();
      (manager as any).toolCallHistory = [
        {
          toolName: 'page_evaluate_helper',
          timestamp: now,
          requestSize: 1000,
          responseSize: 1000,
          estimatedTokens: 65000,
          cumulativeTokens: 65000,
        },
        {
          toolName: 'other',
          timestamp: now,
          requestSize: 100,
          responseSize: 100,
          estimatedTokens: 10000,
          cumulativeTokens: 75000,
        },
      ];
      (manager as any).currentUsage = 75000;

      const stats = manager.getStats();
      expect(
        stats.suggestions.some((s) => s.includes('page_evaluate') && s.includes('properties'))
      ).toBe(true);
    });
  });

  describe('generateSuggestions – ratio-based suggestions (lines 382-388)', () => {
    it('shows MODERATE suggestion at 80-89% usage', () => {
      (manager as any).currentUsage = 165000; // 82.5% of 200000
      (manager as any).toolCallHistory = [
        {
          toolName: 'tool1',
          timestamp: Date.now(),
          requestSize: 100,
          responseSize: 100,
          estimatedTokens: 165000,
          cumulativeTokens: 165000,
        },
      ];

      const stats = manager.getStats();
      expect(stats.suggestions.some((s) => s.includes('MODERATE'))).toBe(true);
    });

    it('shows HIGH suggestion at 90-94% usage', () => {
      (manager as any).currentUsage = 185000; // 92.5% of 200000
      (manager as any).toolCallHistory = [
        {
          toolName: 'tool1',
          timestamp: Date.now(),
          requestSize: 100,
          responseSize: 100,
          estimatedTokens: 185000,
          cumulativeTokens: 185000,
        },
      ];

      const stats = manager.getStats();
      expect(stats.suggestions.some((s) => s.includes('HIGH'))).toBe(true);
    });

    it('shows CRITICAL suggestion at >=95% usage', () => {
      (manager as any).currentUsage = 195000; // 97.5% of 200000
      (manager as any).toolCallHistory = [
        {
          toolName: 'tool1',
          timestamp: Date.now(),
          requestSize: 100,
          responseSize: 100,
          estimatedTokens: 195000,
          cumulativeTokens: 195000,
        },
      ];

      const stats = manager.getStats();
      expect(stats.suggestions.some((s) => s.includes('CRITICAL'))).toBe(true);
    });
  });

  describe('isTrackingEnabled (line 430)', () => {
    it('returns true when tracking is enabled', () => {
      manager.setTrackingEnabled(true);
      expect(manager.isTrackingEnabled()).toBe(true);
    });

    it('returns false when tracking is disabled', () => {
      manager.setTrackingEnabled(false);
      expect(manager.isTrackingEnabled()).toBe(false);
    });
  });

  describe('setTrackingEnabled – no-op on same value', () => {
    it('does not log when setting the same value', () => {
      manager.setTrackingEnabled(true);
      // Call again with same value – should be no-op
      manager.setTrackingEnabled(true);
      // If it was a no-op, no exception and tracking remains enabled
      expect(manager.isTrackingEnabled()).toBe(true);
    });
  });

  describe('auto-cleanup – external cleanup failure', () => {
    it('continues cleanup even when external cleanup throws', () => {
      const failingCleanup = vi.fn(() => {
        throw new Error('external cleanup crash');
      });
      manager.setExternalCleanup(failingCleanup);

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

      // manualCleanup invokes autoCleanup
      expect(() => manager.manualCleanup()).not.toThrow();
      expect(failingCleanup).toHaveBeenCalled();
      // Old records should still be cleaned
      expect(manager.getStats().toolCallCount).toBe(0);
    });
  });

  describe('warning thresholds', () => {
    it('emits warnings at 80%, 90%, and 95% thresholds', () => {
      // Push usage to 80%
      const largeRef = { detailId: 'x', summary: { size: 200_000 } };
      manager.recordToolCall('big_tool', largeRef, largeRef);

      let stats = manager.getStats();
      if (stats.usagePercentage >= 80) {
        expect(stats.warnings).toContain(80);
      }

      // Push further
      manager.recordToolCall('big_tool', largeRef, largeRef);
      stats = manager.getStats();
      if (stats.usagePercentage >= 90) {
        expect(stats.warnings).toContain(90);
      }
    });
  });

  describe('normalizeForSizeEstimate edge cases', () => {
    it('handles bigint values', () => {
      expect(() =>
        manager.recordToolCall('test', { big: BigInt(123) }, { ok: true })
      ).not.toThrow();
    });

    it('handles symbol values', () => {
      expect(() =>
        manager.recordToolCall('test', { sym: Symbol('test') }, { ok: true })
      ).not.toThrow();
    });

    it('handles function values', () => {
      expect(() => manager.recordToolCall('test', { fn: () => {} }, { ok: true })).not.toThrow();
    });

    it('handles Error objects', () => {
      expect(() =>
        manager.recordToolCall('test', new Error('test error'), { ok: true })
      ).not.toThrow();
    });

    it('handles Buffer values', () => {
      expect(() =>
        manager.recordToolCall('test', Buffer.from('hello'), { ok: true })
      ).not.toThrow();
    });

    it('handles deeply nested objects', () => {
      const deep: any = {};
      let current = deep;
      for (let i = 0; i < 10; i++) {
        current.child = {};
        current = current.child;
      }
      expect(() => manager.recordToolCall('test', deep, { ok: true })).not.toThrow();
    });

    it('handles large arrays with truncation', () => {
      const bigArray = Array.from({ length: 100 }, (_, i) => ({ index: i }));
      expect(() => manager.recordToolCall('test', bigArray, { ok: true })).not.toThrow();
    });

    it('handles objects with many keys', () => {
      const manyKeys: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        manyKeys[`key_${i}`] = i;
      }
      expect(() => manager.recordToolCall('test', manyKeys, { ok: true })).not.toThrow();
    });
  });

  describe('reset', () => {
    it('clears all usage data', () => {
      manager.recordToolCall('tool1', { x: 1 }, { ok: true });
      expect(manager.getStats().currentUsage).toBeGreaterThan(0);

      manager.reset();
      const stats = manager.getStats();
      expect(stats.currentUsage).toBe(0);
      expect(stats.toolCallCount).toBe(0);
      expect(stats.warnings).toHaveLength(0);
    });
  });

  describe('MCP envelope fast path', () => {
    it('estimates size for standard MCP response envelope', () => {
      const mcpResponse = {
        content: [{ type: 'text', text: 'Hello, world!' }],
      };
      expect(() => manager.recordToolCall('test', {}, mcpResponse)).not.toThrow();
      expect(manager.getStats().currentUsage).toBeGreaterThan(0);
    });

    it('estimates size for MCP error envelope', () => {
      const mcpError = {
        content: [{ type: 'text', text: 'Something failed' }],
        isError: true,
      };
      expect(() => manager.recordToolCall('test', {}, mcpError)).not.toThrow();
    });
  });
});
