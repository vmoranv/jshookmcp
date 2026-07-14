import { describe, it, expect } from 'vitest';
import { classifyGpu, classifyGpuInputs } from '@server/domains/maintenance/gpu-detect';

describe('gpu-detect classifyGpu', () => {
  it('classifies the caller-supplied WebGL, WebGPU, and device strings', () => {
    const result = classifyGpuInputs({
      webglRenderer: 'ANGLE (NVIDIA Tesla T4)',
      webgpuDescription: 'VMware SVGA 3D',
      deviceName: 'Apple M2 Pro',
    });

    expect(result.method).toBe('caller-supplied renderer strings');
    expect(result.gpus.map((gpu) => gpu.model)).toEqual([
      'ANGLE (NVIDIA Tesla T4)',
      'VMware SVGA 3D',
      'Apple M2 Pro',
    ]);
    expect(result.isCloudGpu).toBe(true);
    expect(result.isVirtualMachine).toBe(true);
  });

  describe('cloud GPU detection', () => {
    it('detects Tesla T4 as cloud GPU', () => {
      const c = classifyGpu('Tesla T4');
      expect(c.isCloudGpu).toBe(true);
      expect(c.isVirtualMachine).toBe(false);
      expect(c.reason).toContain('Cloud GPU');
    });

    it('detects A100 as cloud GPU', () => {
      const c = classifyGpu('NVIDIA A100-SXM4-40GB');
      expect(c.isCloudGpu).toBe(true);
    });

    it('detects H100 as cloud GPU', () => {
      const c = classifyGpu('NVIDIA H100 80GB HBM3');
      expect(c.isCloudGpu).toBe(true);
    });

    it('detects A10G as cloud GPU', () => {
      const c = classifyGpu('NVIDIA A10G');
      expect(c.isCloudGpu).toBe(true);
    });

    it('detects L4 as cloud GPU', () => {
      const c = classifyGpu('NVIDIA L4');
      expect(c.isCloudGpu).toBe(true);
    });

    it('detects Tesla V100 as cloud GPU', () => {
      const c = classifyGpu('Tesla V100-SXM2-32GB');
      expect(c.isCloudGpu).toBe(true);
    });

    it('detects Tesla P100 as cloud GPU', () => {
      const c = classifyGpu('Tesla P100-PCIE-16GB');
      expect(c.isCloudGpu).toBe(true);
    });

    it('flags RTX 4090 as non-cloud (consumer GPU)', () => {
      const c = classifyGpu('NVIDIA GeForce RTX 4090');
      expect(c.isCloudGpu).toBe(false);
    });

    it('flags Intel UHD as non-cloud', () => {
      const c = classifyGpu('Intel(R) UHD Graphics 630');
      expect(c.isCloudGpu).toBe(false);
    });

    it('flags AMD Radeon as non-cloud', () => {
      const c = classifyGpu('AMD Radeon RX 7900 XTX');
      expect(c.isCloudGpu).toBe(false);
    });

    it('flags Apple M2 as non-cloud', () => {
      const c = classifyGpu('Apple M2 Pro');
      expect(c.isCloudGpu).toBe(false);
    });

    it('does case-insensitive matching', () => {
      const c = classifyGpu('nvidia tesla t4');
      expect(c.isCloudGpu).toBe(true);
    });
  });

  describe('VM detection', () => {
    it('detects VMware GPU as VM', () => {
      const c = classifyGpu('VMware SVGA 3D');
      expect(c.isVirtualMachine).toBe(true);
      expect(c.isCloudGpu).toBe(false);
      expect(c.reason).toContain('VM GPU');
    });

    it('detects VirtualBox Graphics as VM', () => {
      const c = classifyGpu('VirtualBox Graphics Adapter');
      expect(c.isVirtualMachine).toBe(true);
    });

    it('detects Hyper-V as VM', () => {
      const c = classifyGpu('Microsoft Hyper-V Video');
      expect(c.isVirtualMachine).toBe(true);
    });

    it('detects QXL as VM', () => {
      const c = classifyGpu('QXL paravirtual graphic card');
      expect(c.isVirtualMachine).toBe(true);
    });

    it('detects Parallels as VM', () => {
      const c = classifyGpu('Parallels Display Adapter (WDDM)');
      expect(c.isVirtualMachine).toBe(true);
    });

    it('detects Microsoft Basic Render as VM', () => {
      const c = classifyGpu('Microsoft Basic Render Driver');
      expect(c.isVirtualMachine).toBe(true);
    });

    it('detects VirtIO GPU as VM', () => {
      const c = classifyGpu('VirtIO GPU');
      expect(c.isVirtualMachine).toBe(true);
    });

    it('flags physical GPU as non-VM', () => {
      const c = classifyGpu('NVIDIA GeForce RTX 3060');
      expect(c.isVirtualMachine).toBe(false);
      expect(c.reason).toContain('Local');
    });
  });

  describe('vendor detection', () => {
    it('detects NVIDIA vendor', () => {
      const c = classifyGpu('NVIDIA GeForce RTX 3080');
      expect(c.model).toBe('NVIDIA GeForce RTX 3080');
    });

    it('detects AMD vendor', () => {
      const c = classifyGpu('AMD Radeon RX 6800 XT');
      expect(c.model).toBe('AMD Radeon RX 6800 XT');
    });
  });
});
