import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Page } from 'rebrowser-puppeteer-core';
import {
  getGPUMemoryStats,
  installGPUCommandHook,
  uninstallGPUCommandHook,
  getGPUCommandTrace,
  analyzeCommandTrace,
  ensureDevice,
  releaseDevice,
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
      expect(stats.memorySource).toBe('cdp');
      // No tracked allocations → trackedBytes is 0, but the CDP metric still wins.
      expect(stats.trackedBytes).toBe(0);
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
      // No CDP metric and no tracked allocations → estimated fallback.
      expect(stats.memorySource).toBe('estimated');
      expect(stats.trackedBytes).toBe(0);
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
      // No CDP metric but allocations present → tracked mode.
      expect(stats.trackedBytes).toBe(1024 + 2048);
      expect(stats.memorySource).toBe('tracked');
      expect(stats.usedHeapSize).toBe(1024 + 2048);
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
      expect(stats.memorySource).toBe('cdp');
    });

    it('memorySource=cdp when GPUMemoryUsedKB is present', async () => {
      mockCDP.send.mockImplementation((method: string) => {
        if (method === 'Performance.getMetrics') {
          return Promise.resolve({
            metrics: [{ name: 'GPUMemoryUsedKB', value: 256 }],
          });
        }
        return Promise.resolve({});
      });

      // Tracked allocations also present — CDP metric should still win.
      mockPage.evaluate.mockResolvedValue([{ size: 4096, usage: 'UNIFORM', label: 'u1' }]);

      const stats = await getGPUMemoryStats(mockPage as Page);

      expect(stats.memorySource).toBe('cdp');
      expect(stats.usedHeapSize).toBe(256 * 1024);
      // trackedBytes is always computed regardless of CDP availability.
      expect(stats.trackedBytes).toBe(4096);
    });

    it('memorySource=tracked when CDP metric missing but allocations exist', async () => {
      mockCDP.send.mockImplementation((method: string) => {
        if (method === 'Performance.getMetrics') {
          return Promise.resolve({ metrics: [{ name: 'JSHeapUsedSize', value: 999 }] });
        }
        return Promise.resolve({});
      });

      mockPage.evaluate.mockResolvedValue([
        { size: 100, usage: 'VERTEX', label: 'a' },
        { size: 200, usage: 'INDEX', label: 'b' },
        { size: 300, usage: 'STORAGE', label: 'c' },
      ]);

      const stats = await getGPUMemoryStats(mockPage as Page);

      expect(stats.memorySource).toBe('tracked');
      expect(stats.trackedBytes).toBe(600);
      expect(stats.usedHeapSize).toBe(600);
      // Heap estimate should be derived from trackedBytes in tracked mode.
      expect(stats.heapSize).toBeGreaterThanOrEqual(600 * 2);
    });

    it('memorySource=estimated when neither CDP metric nor allocations', async () => {
      mockCDP.send.mockImplementation((method: string) => {
        if (method === 'Performance.getMetrics') {
          return Promise.resolve({ metrics: [] });
        }
        return Promise.resolve({});
      });

      mockPage.evaluate.mockResolvedValue([]);

      const stats = await getGPUMemoryStats(mockPage as Page);

      expect(stats.memorySource).toBe('estimated');
      expect(stats.usedHeapSize).toBe(0);
      expect(stats.trackedBytes).toBe(0);
      // Conservative 256MB floor still applies.
      expect(stats.heapSize).toBe(256 * 1024 * 1024);
    });

    it('trackedBytes sums all live allocation sizes even when CDP metric present', async () => {
      mockCDP.send.mockImplementation((method: string) => {
        if (method === 'Performance.getMetrics') {
          return Promise.resolve({
            metrics: [{ name: 'GPUMemoryUsedKB', value: 128 }],
          });
        }
        return Promise.resolve({});
      });

      mockPage.evaluate.mockResolvedValue([
        { size: 1000, usage: 'VERTEX' },
        { size: 2000, usage: 'INDEX' },
        { size: 3000, usage: 'STORAGE' },
      ]);

      const stats = await getGPUMemoryStats(mockPage as Page);

      // CDP metric wins for usedHeapSize, but trackedBytes still reports the sum.
      expect(stats.memorySource).toBe('cdp');
      expect(stats.usedHeapSize).toBe(128 * 1024);
      expect(stats.trackedBytes).toBe(6000);
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

      expect(mockPage.evaluate).toHaveBeenCalledTimes(3); // hookState init + install hook code + uninstall
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

    it('install script wraps render pass pipeline-state methods (defect #3)', async () => {
      mockPage.evaluateOnNewDocument.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue(undefined);

      await installGPUCommandHook(mockPage as Page, 100);

      // The install page.evaluate call payload is a function source string.
      // Verify it references the pipeline-state methods we now hook.
      const evalCalls = mockPage.evaluate.mock.calls;
      const installCall = evalCalls.find((c: any[]) => c.length > 1 && typeof c[0] === 'function');
      expect(installCall).toBeDefined();

      const installFn = installCall![0] as Function;
      const source = installFn.toString();

      // Render-pass pipeline-state hooks
      expect(source).toContain('setPipeline');
      expect(source).toContain('setVertexBuffer');
      expect(source).toContain('setBindGroup');
      expect(source).toContain('setIndexBuffer');
      // New command-state fields must be populated in the pushed command object.
      expect(source).toContain('pipelineSet');
      expect(source).toContain('vertexBuffers');
      expect(source).toContain('bindGroups');
      expect(source).toContain('indexBufferSet');
    });

    it('install script wraps compute pass setPipeline and setBindGroup (defect #3)', async () => {
      mockPage.evaluateOnNewDocument.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue(undefined);

      await installGPUCommandHook(mockPage as Page, 100);

      const evalCalls = mockPage.evaluate.mock.calls;
      const installCall = evalCalls.find((c: any[]) => c.length > 1 && typeof c[0] === 'function');
      const source = (installCall![0] as Function).toString();

      // Compute pass encoder also has setPipeline/setBindGroup; the hook body
      // references them. Ensure both wrapComputePassEncoder and the field
      // population path exist.
      expect(source).toContain('wrapComputePassEncoder');
      expect(source).toContain('setPipeline');
      expect(source).toContain('setBindGroup');
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
      expect(analyzed.inferredTypes[0]!.inferredType).toBe('render');
      expect(analyzed.inferredTypes[1]!.inferredType).toBe('render');
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

      expect(analyzed.inferredTypes[0]!.inferredType).toBe('compute');
      expect(analyzed.inferredTypes[1]!.inferredType).toBe('compute');
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

      expect(analyzed.inferredTypes[0]!.inferredType).toBe('copy');
      expect(analyzed.inferredTypes[1]!.inferredType).toBe('copy');
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
      expect(analyzed.inferredTypes[0]!.inferredType).toBe('copy');
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

  describe('ensureDevice (defect #5: multi-adapter/device cache)', () => {
    it('creates a new device on first call (fresh=true)', async () => {
      const handle = {
        adapter: { __mock: 'adapter' },
        device: { __mock: 'device' },
        fresh: true,
        adapterInfo: {
          vendor: 'arm',
          architecture: 'mali-g78',
          device: 'Mali-G78',
          description: 'mock gpu',
        },
      };
      mockPage.evaluate.mockResolvedValue(handle);

      const result = await ensureDevice(mockPage as Page);

      expect(result.fresh).toBe(true);
      expect(result.adapter).toBe(handle.adapter);
      expect(result.device).toBe(handle.device);
      expect(result.adapterInfo.vendor).toBe('arm');
      // evaluate called with powerPreference default 'none'
      const evalCall = mockPage.evaluate.mock.calls[0];
      expect(evalCall).toBeDefined();
      expect(evalCall![1]).toBe('none');
    });

    it('reuses cached device on subsequent call (fresh=false)', async () => {
      const handle = {
        adapter: { __mock: 'adapter' },
        device: { __mock: 'device' },
        fresh: false,
        adapterInfo: {
          vendor: 'qualcomm',
          architecture: 'adreno',
          device: 'Adreno 740',
          description: '',
        },
      };
      mockPage.evaluate.mockResolvedValue(handle);

      const result = await ensureDevice(mockPage as Page);

      expect(result.fresh).toBe(false);
      expect(result.adapterInfo.vendor).toBe('qualcomm');
    });

    it('throws when navigator.gpu is undefined', async () => {
      mockPage.evaluate.mockRejectedValue(
        new Error('WebGPU not available: navigator.gpu is undefined.'),
      );

      await expect(ensureDevice(mockPage as Page)).rejects.toThrow('WebGPU not available');
    });

    it('throws when no suitable adapter is available', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('No suitable GPUAdapter available.'));

      await expect(ensureDevice(mockPage as Page)).rejects.toThrow('No suitable GPUAdapter');
    });

    it('forwards powerPreference to evaluate', async () => {
      const handle = {
        adapter: {},
        device: {},
        fresh: true,
        adapterInfo: { vendor: '', architecture: '', device: '', description: '' },
      };
      mockPage.evaluate.mockResolvedValue(handle);

      await ensureDevice(mockPage as Page, { powerPreference: 'high-performance' });

      const evalCall = mockPage.evaluate.mock.calls[0];
      expect(evalCall![1]).toBe('high-performance');
    });

    it('forwards low-power powerPreference to evaluate', async () => {
      const handle = {
        adapter: {},
        device: {},
        fresh: true,
        adapterInfo: { vendor: '', architecture: '', device: '', description: '' },
      };
      mockPage.evaluate.mockResolvedValue(handle);

      await ensureDevice(mockPage as Page, { powerPreference: 'low-power' });

      const evalCall = mockPage.evaluate.mock.calls[0];
      expect(evalCall![1]).toBe('low-power');
    });

    it('evaluate body references device.lost recovery + cache identifier', async () => {
      mockPage.evaluate.mockResolvedValue({
        adapter: {},
        device: {},
        fresh: true,
        adapterInfo: { vendor: '', architecture: '', device: '', description: '' },
      });

      await ensureDevice(mockPage as Page);

      const evalCall = mockPage.evaluate.mock.calls[0];
      const fn = evalCall![0] as Function;
      const source = fn.toString();

      // Cache identifier must match releaseDevice
      expect(source).toContain('__webgpuDeviceCache');
      // device.lost recovery wiring
      expect(source).toContain('device.lost');
      expect(source).toContain('lost');
      // requestAdapter + requestDevice invocation
      expect(source).toContain('requestAdapter');
      expect(source).toContain('requestDevice');
    });
  });

  describe('releaseDevice (defect #5)', () => {
    it('clears the device cache in page context', async () => {
      mockPage.evaluate.mockResolvedValue(undefined);

      await releaseDevice(mockPage as Page);

      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      const evalCall = mockPage.evaluate.mock.calls[0];
      const fn = evalCall![0] as Function;
      const source = fn.toString();
      expect(source).toContain('__webgpuDeviceCache');
    });

    it('does not throw when cache is already empty', async () => {
      mockPage.evaluate.mockResolvedValue(undefined);

      await expect(releaseDevice(mockPage as Page)).resolves.toBeUndefined();
    });
  });
});
