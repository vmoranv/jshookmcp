/**
 * WebGPU domain type definitions
 */

export interface GPUAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

export interface ShaderMetadata {
  entryPoints: Array<{
    name: string;
    stage: 'vertex' | 'fragment' | 'compute';
  }>;
  uniforms?: Array<{
    name: string;
    binding: number;
    group: number;
  }>;
  attributes?: Array<{
    name: string;
    location: number;
  }>;
  structs?: Array<{
    name: string;
    fields: Array<{
      name: string;
      type: string;
    }>;
  }>;
  bindingsByType?: Record<string, number>;
}

export interface GPUCommand {
  type: 'render' | 'compute' | 'copy';
  drawCalls?: number;
  dispatches?: { x: number; y: number; z: number };
  pipelineLabel?: string;
  passLabel?: string;
  timestamp: number;
}

export interface GPUMemoryAllocation {
  size: number;
  usage: string;
  label?: string;
  type?: 'buffer' | 'texture' | 'textureView';
  alive?: boolean;
}

export interface TimingStats {
  timings: number[];
  mean: number;
  stddev: number;
  min: number;
  max: number;
  anomalies?: Array<{
    index: number;
    value: number;
    deviation: number;
  }>;
}

export interface WebGPUDomainDependencies {
  pageController?: {
    getActivePage(): Promise<any>;
  };
}
