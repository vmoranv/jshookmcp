import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Page } from 'rebrowser-puppeteer-core';
import {
  getGPUMemoryStats,
  installGPUCommandHook,
  uninstallGPUCommandHook,
  getGPUCommandTrace,
  analyzeCommandTrace,
  type GPUCommandTrace,
} from '@modules/webgpu/CDPIntegration';

describe('CDPIntegration', () => {
  let mockPage: any;
  let mockCDP: any;

  beforeEach(() => {
    mockCDP = {
      send: vi.fn(),
      detach: vi.fn(),
    };

    mockPage = {
      createCDPSession: vi.fn().mockResolvedValue(mockCDP),
      evaluate: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
    };
  });

  describe('getGPUMemoryStats', () => {
    it('should retrieve GPU memory statistics via CDP', async () => {
      mockCDP.send.mockImplementation((method: string) => {
        if (method === 'Memory.getDOMCounters') {
          return Promise.resolve({});
        }
        if (method === 'Performance.getMetrics') {
          return Promise.resolve({
            metrics: [
              { name: 'GPUMemoryUsedKB', value: 512 },
              { name: 'OtherMetric', value: 100 },
            ],
          });
        }
        return Promise.resolve({});
      });

      mockPage.evaluate.mockResolvedValue([]);

      const stats = await getGPUMemoryStats(mockPage as Page);

      expect(stats).toHaveProperty('heapSize');
      expect(stats).toHaveProperty('usedHeapSize');
      expect(stats).toHaveProperty('allocations');
      expect(stats.usedHeapSize).toBe(512 * 1024);
      expect(mockCDP.detach).toHaveBeenCalled();
    });

    it('should handle missing GPU metrics', async () => {
      mockCDP.send.mockImplementation((method: string) => {
        if (method === 'Performance.getMetrics') {
          return Promise.resolve({
            metrics: [{ name: 'OtherMetric', value: 100 }],
          });
        }
        return Promise.resolve({});
      });

      mockPage.evaluate.mockResolvedValue([]);

      const stats = await getGPUMemoryStats(mockPage as Page);

      expect(stats.usedHeapSize).toBe(0);
      expect(stats.heapSize).toBeGreaterThan(0);
    });

    it('should retrieve allocations from page context', async () => {
      mockCDP.send.mockResolvedValue({
        metrics: [],
      });

      const mockAllocations = [
        { size: 1024, usage: 'VERTEX', label: 'buffer1' },
        { size: 2048, usage: 'INDEX', label: 'buffer2' },
      ];

      mockPage.evaluate.mockResolvedValue(mockAllocations);

      const stats = await getGPUMemoryStats(mockPage as Page);

      expect(stats.allocations).toEqual(mockAllocations);
    });

    it('should detach CDP session even on error', async () => {
      mockCDP.send.mockRejectedValue(new Error('CDP error'));

      await expect(getGPUMemoryStats(mockPage as Page)).rejects.toThrow('CDP error');

      expect(mockCDP.detach).toHaveBeenCalled();
    });

    it('should estimate heap size based on used memory', async () => {
      mockCDP.send.mockImplementation((method: string) => {
        if (method === 'Performance.getMetrics') {
          return Promise.resolve({
            metrics: [{ name: 'GPUMemoryUsedKB', value: 1024 }],
          });
        }
        return Promise.resolve({});
      });

      mockPage.evaluate.mockResolvedValue([]);

      const stats = await getGPUMemoryStats(mockPage as Page);

      // Heap size should be at least 2x used size
      expect(stats.heapSize).toBeGreaterThanOrEqual(stats.usedHeapSize * 2);
    });
  });

  describe('installGPUCommandHook', () => {
    it('should install command capture hook', async () => {
      mockPage.evaluateOnNewDocument.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue(undefined);

      const cleanup = await installGPUCommandHook(mockPage as Page, 100);

      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(typeof cleanup).toBe('function');

      // The install sends captureCount via page.evaluate (not evaluateOnNewDocument)
      const evalCalls = mockPage.evaluate.mock.calls;
      const installCall = evalCalls.find((c: any[]) => c.length > 1 && c[1] === 100);
      expect(installCall).toBeDefined();
    });

    it('should return cleanup function that uninstalls hooks', async () => {
      mockPage.evaluateOnNewDocument.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue(undefined);

      const cleanup = await installGPUCommandHook(mockPage as Page, 100);

      await cleanup();

      expect(mockPage.evaluate).toHaveBeenCalledTimes(2); // install + uninstall
    });

    it('should pass capture count to hook', async () => {
      mockPage.evaluateOnNewDocument.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue(undefined);

      await installGPUCommandHook(mockPage as Page, 50);

      const evalCalls = mockPage.evaluate.mock.calls;
      const installCall = evalCalls.find((c: any[]) => c.length > 1 && c[1] === 50);
      expect(installCall).toBeDefined();
    });

    it('should expose uninstallGPUCommandHook helper', async () => {
      mockPage.evaluate.mockResolvedValue(undefined);

      await uninstallGPUCommandHook(mockPage as Page);

      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('getGPUCommandTrace', () => {
    it('should retrieve command trace from page', async () => {
      mockPage.evaluate.mockResolvedValue({
        commands: [
          { type: 'render', timestamp: 100 },
          { type: 'compute', timestamp: 200 },
        ],
        totalSubmissions: 2,
        captureStartTime: 50,
        captureEndTime: 250,
      });

      const trace = await getGPUCommandTrace(mockPage as Page);

      expect(trace.commands).toHaveLength(2);
      expect(trace.totalSubmissions).toBe(2);
      expect(trace.captureStartTime).toBe(50);
      expect(trace.captureEndTime).toBe(250);
    });

    it('should handle missing trace data', async () => {
      mockPage.evaluate.mockResolvedValue(null);

      const trace = await getGPUCommandTrace(mockPage as Page);

      expect(trace.commands).toEqual([]);
      expect(trace.totalSubmissions).toBe(0);
      expect(trace.captureStartTime).toBe(0);
      expect(trace.captureEndTime).toBe(0);
    });

    it('should return empty trace when hook not injected', async () => {
      mockPage.evaluate.mockResolvedValue(null);

      const trace = await getGPUCommandTrace(mockPage as Page);

      expect(trace.commands).toEqual([]);
    });
  });

  describe('analyzeCommandTrace', () => {
    it('should infer render commands from short gaps', () => {
      const trace: GPUCommandTrace = {
        commands: [
          { type: 'unknown', timestamp: 0 } as any,
          { type: 'unknown', timestamp: 10 } as any,
          { type: 'unknown', timestamp: 20 } as any,
        ],
        totalSubmissions: 3,
        captureStartTime: 0,
        captureEndTime: 20,
      };

      const analyzed = analyzeCommandTrace(trace);

      expect(analyzed.inferredTypes).toHaveLength(3);
      expect(analyzed.inferredTypes[0].inferredType).toBe('render');
      expect(analyzed.inferredTypes[1].inferredType).toBe('render');
    });

    it('should infer compute commands from long gaps', () => {
      const trace: GPUCommandTrace = {
        commands: [
          { type: 'unknown', timestamp: 0 } as any,
          { type: 'unknown', timestamp: 100 } as any,
          { type: 'unknown', timestamp: 200 } as any,
        ],
        totalSubmissions: 3,
        captureStartTime: 0,
        captureEndTime: 200,
      };

      const analyzed = analyzeCommandTrace(trace);

      expect(analyzed.inferredTypes[0].inferredType).toBe('compute');
      expect(analyzed.inferredTypes[1].inferredType).toBe('compute');
    });

    it('should infer copy commands from very short gaps', () => {
      const trace: GPUCommandTrace = {
        commands: [
          { type: 'unknown', timestamp: 0 } as any,
          { type: 'unknown', timestamp: 2 } as any,
          { type: 'unknown', timestamp: 4 } as any,
        ],
        totalSubmissions: 3,
        captureStartTime: 0,
        captureEndTime: 4,
      };

      const analyzed = analyzeCommandTrace(trace);

      expect(analyzed.inferredTypes[0].inferredType).toBe('copy');
      expect(analyzed.inferredTypes[1].inferredType).toBe('copy');
    });

    it('should handle empty trace', () => {
      const trace: GPUCommandTrace = {
        commands: [],
        totalSubmissions: 0,
        captureStartTime: 0,
        captureEndTime: 0,
      };

      const analyzed = analyzeCommandTrace(trace);

      expect(analyzed.inferredTypes).toEqual([]);
    });

    it('should handle single command', () => {
      const trace: GPUCommandTrace = {
        commands: [{ type: 'unknown', timestamp: 0 } as any],
        totalSubmissions: 1,
        captureStartTime: 0,
        captureEndTime: 0,
      };

      const analyzed = analyzeCommandTrace(trace);

      expect(analyzed.inferredTypes).toHaveLength(1);
      // Single command with no next command has gap=0, which is < 5 → inferred as 'copy'
      expect(analyzed.inferredTypes[0].inferredType).toBe('copy');
    });

    it('should preserve original trace data', () => {
      const trace: GPUCommandTrace = {
        commands: [
          { type: 'unknown', timestamp: 0 } as any,
          { type: 'unknown', timestamp: 10 } as any,
        ],
        totalSubmissions: 2,
        captureStartTime: 5,
        captureEndTime: 15,
      };

      const analyzed = analyzeCommandTrace(trace);

      expect(analyzed.commands).toEqual(trace.commands);
      expect(analyzed.totalSubmissions).toBe(trace.totalSubmissions);
      expect(analyzed.captureStartTime).toBe(trace.captureStartTime);
      expect(analyzed.captureEndTime).toBe(trace.captureEndTime);
    });
  });
});
