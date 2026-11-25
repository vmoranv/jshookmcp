import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { getGPUMemoryStats } from '@modules/webgpu/MemoryTracking';

function makeCdp() {
  return {
    send: vi.fn(async (method: string) => {
      if (method === 'Performance.getMetrics') {
        return { metrics: [] };
      }
      return {};
    }),
    detach: vi.fn(async () => {}),
  };
}

function makePage() {
  const cdp = makeCdp();
  return {
    cdp,
    page: {
      createCDPSession: vi.fn(async () => cdp),
      evaluate: vi.fn(async () => []),
      evaluateOnNewDocument: vi.fn(async () => {}),
    } as any,
  };
}

describe('MemoryTracking allocation tracker', () => {
  it('installs on the live document and handles a pre-existing hook state', async () => {
    const { page } = makePage();

    await getGPUMemoryStats(page);

    // Both the persistent (future navigations) and live-document paths use
    // the exact same installer function.
    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    const installer = page.evaluateOnNewDocument.mock.calls[0]![0] as () => void;
    expect(page.evaluate.mock.calls[0]![0]).toBe(installer);

    const proto = {
      createBuffer(this: any, descriptor: any) {
        return { size: descriptor.size };
      },
      createTexture(this: any, descriptor: any) {
        return { size: descriptor.size };
      },
    };
    const FakeDevice: any = function FakeDevice() {};
    FakeDevice.prototype = proto;

    const state = {
      originalSubmit: null,
      originalCreateCommandEncoder: null,
      hooksInstalled: false,
      commandTrace: null,
      allocations: [] as unknown[],
    };
    const windowObj: any = { webgpuHookState: state };
    const sandbox: any = {
      window: windowObj,
      GPUDevice: FakeDevice,
      GPUQueue: function FakeQueue() {},
      WeakRef,
      console,
    };

    runInNewContext(`(${String(installer)})()`, sandbox);

    // A pre-existing webgpuHookState (created by CommandHook) must not block
    // wrapper installation.
    expect((state as any).allocationsTrackerInstalled).toBe(true);
    const device = new FakeDevice();
    (device as any).createBuffer({ size: 128, usage: 1, label: 'b' });
    expect(state.allocations).toHaveLength(1);
    expect(state.allocations[0]).toMatchObject({ size: 128, type: 'buffer', label: 'b' });

    // Second run is a no-op (no double wrapping / duplicate records).
    runInNewContext(`(${String(installer)})()`, sandbox);
    (device as any).createBuffer({ size: 256, usage: 1 });
    expect(state.allocations).toHaveLength(2);
  });
});
