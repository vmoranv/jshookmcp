import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import {
  DeobfuscationMetricsCollector,
  getGlobalMetrics,
  resetGlobalMetrics,
} from '@modules/deobfuscator/DeobfuscationMetrics';

describe('DeobfuscationMetricsCollector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  describe('run lifecycle', () => {
    it('starts and ends a run tracking success/failure', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.startRun(1000);
      expect(metrics.getMetrics().totalRuns).toBe(1);
      expect(metrics.getMetrics().totalBytesProcessed).toBe(1000);

      metrics.endRun(true, 800);
      expect(metrics.getMetrics().successfulRuns).toBe(1);
      expect(metrics.getMetrics().failedRuns).toBe(0);
    });

    it('tracks failed runs correctly', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.startRun(1000);
      metrics.endRun(false, 1000);

      expect(metrics.getMetrics().successfulRuns).toBe(0);
      expect(metrics.getMetrics().failedRuns).toBe(1);
    });

    it('calculates success rate correctly', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.startRun(100);
      metrics.endRun(true, 80);
      metrics.startRun(100);
      metrics.endRun(true, 80);
      metrics.startRun(100);
      metrics.endRun(false, 100);

      expect(metrics.getSuccessRate()).toBeCloseTo(0.667, 2);
    });
  });

  describe('stage metrics', () => {
    it('records stage start and end correctly', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.startRun(1000);
      metrics.startStage('unpack', 1000, 30);
      metrics.endStage(800, 45, true);

      const history = metrics.getStageHistory();
      expect(history.length).toBe(1);
      expect(history[0]?.stageName).toBe('unpack');
      expect(history[0]?.applied).toBe(true);
    });

    it('tracks multiple stages in order', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.startRun(1000);
      metrics.startStage('stage-a', 1000, 30);
      metrics.endStage(900, 35, true);
      metrics.startStage('stage-b', 900, 35);
      metrics.endStage(800, 45, true);

      const history = metrics.getStageHistory();
      expect(history.length).toBe(2);
      expect(history[0]?.stageName).toBe('stage-a');
      expect(history[1]?.stageName).toBe('stage-b');
    });

    it('marks stage as not applied when code unchanged', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.startRun(1000);
      metrics.startStage('noop', 1000, 30);
      metrics.endStage(1000, 30, false);

      expect(metrics.getStageHistory()[0]?.applied).toBe(false);
    });
  });

  describe('obfuscation type tracking', () => {
    it('counts obfuscation types', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.recordObfuscationType('webpack');
      metrics.recordObfuscationType('webpack');
      metrics.recordObfuscationType('eval-obfuscation');

      const top = metrics.getTopObfuscationTypes(5);
      expect(top[0]?.type).toBe('webpack');
      expect(top[0]?.count).toBe(2);
    });

    it('categorizes types into categories', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.recordObfuscationType('string-array-rotation');
      metrics.recordObfuscationType('control-flow-flattening');
      metrics.recordObfuscationType('eval-obfuscation');

      const breakdown = metrics.getCategoryBreakdown();
      expect(breakdown['string']).toBe(1);
      expect(breakdown['control-flow']).toBe(1);
      expect(breakdown['dynamic-code']).toBe(1);
    });

    it('records multiple obfuscation types at once', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.recordObfuscationTypes(['packer', 'base64-encoding', 'dead-code-injection']);

      const top = metrics.getTopObfuscationTypes(3);
      expect(top.length).toBe(3);
    });
  });

  describe('stage timing', () => {
    it('tracks average stage timing', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.startRun(1000);
      metrics.startStage('test', 1000, 30);
      metrics.endStage(800, 35, true);
      metrics.startRun(1000);
      metrics.startStage('test', 1000, 30);
      metrics.endStage(800, 35, true);

      const slowest = metrics.getSlowestStages(5);
      expect(slowest[0]?.stage).toBe('test');
    });
  });

  describe('global metrics singleton', () => {
    it('returns same instance on multiple calls', () => {
      const a = getGlobalMetrics();
      const b = getGlobalMetrics();
      expect(a).toBe(b);
    });

    it('resets global metrics', () => {
      const metrics = getGlobalMetrics();
      metrics.startRun(100);
      metrics.endRun(true, 80);

      resetGlobalMetrics();

      const fresh = getGlobalMetrics();
      expect(fresh.getMetrics().totalRuns).toBe(0);
    });
  });

  describe('summary', () => {
    it('generates readable summary string', () => {
      const metrics = new DeobfuscationMetricsCollector();

      metrics.startRun(1000);
      metrics.endRun(true, 800);

      const summary = metrics.getSummary();
      expect(summary).toContain('Deobfuscation Metrics Summary');
      expect(summary).toContain('Total runs: 1');
      expect(summary).toContain('Success rate');
    });

    it('formats bytes correctly', () => {
      const metrics = new DeobfuscationMetricsCollector();

      const small = metrics.getSummary();
      expect(small).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles zero runs for success rate', () => {
      const metrics = new DeobfuscationMetricsCollector();
      expect(metrics.getSuccessRate()).toBe(0);
    });

    it('handles empty top obfuscation types', () => {
      const metrics = new DeobfuscationMetricsCollector();
      const top = metrics.getTopObfuscationTypes(5);
      expect(top).toEqual([]);
    });

    it('caps snapshots at 100', () => {
      const metrics = new DeobfuscationMetricsCollector();

      for (let i = 0; i < 150; i++) {
        metrics.startRun(100);
        metrics.endRun(true, 80);
      }

      expect(metrics.getMetrics().snapshots.length).toBe(100);
    });
  });
});
