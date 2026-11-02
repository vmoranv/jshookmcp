/**
 * WebGPU domain type definitions
 */

export interface GPUAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

/**
 * Metadata extracted from a shader (WGSL or SPIR-V).
 *
 * `parseWarnings` is populated when the lightweight parser detects constructs
 * it cannot fully resolve (e.g. deeply nested types, unsupported grammar).
 * Consumers SHOULD surface these warnings so users know the metadata may be
 * incomplete. This keeps parsing fail-soft rather than silently dropping data.
 */
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
  /** Non-fatal parser warnings (nested types, unsupported grammar, etc.). */
  parseWarnings?: string[];
  /** Source format that produced this metadata. */
  format?: 'wgsl' | 'spirv';
}

/**
 * A captured GPU command (render pass / compute pass / copy op).
 *
 * Pipeline-state fields (`pipelineSet`, `vertexBuffers`, `bindGroups`,
 * `indexBufferSet`) are populated by the enhanced command hook when the
 * application calls the corresponding encoder methods. They are optional
 * because not every pass exercises every method, and older traces (produced
 * before the hook enhancement) will not contain them.
 */
export interface GPUCommand {
  type: 'render' | 'compute' | 'copy';
  drawCalls?: number;
  dispatches?: { x: number; y: number; z: number };
  pipelineLabel?: string;
  passLabel?: string;
  timestamp: number;
  /** True when `setPipeline` was called within this pass. */
  pipelineSet?: boolean;
  /** Vertex buffer slots bound via `setVertexBuffer`. */
  vertexBuffers?: number[];
  /** Bind group indices set via `setBindGroup`. */
  bindGroups?: number[];
  /** True when `setIndexBuffer` was called (render passes only). */
  indexBufferSet?: boolean;
  /** Vertex count of the last `draw`/`drawIndexed` call in this pass. */
  vertexCount?: number;
  /** Instance count of the last `draw`/`drawIndexed` call (default 1). */
  instanceCount?: number;
  /** True when the last draw was `drawIndirect`/`drawIndexedIndirect`. */
  indirect?: boolean;
  /** Indirect buffer size in bytes (best-effort; undefined for direct draws). */
  indirectBufferSize?: number;
  /** Sum of vertex counts across all direct draws in this pass. */
  totalVertexCount?: number;
  /** GPU timestamp for pass start in ns (timestamp-query mode only). */
  gpuStartNs?: number;
  /** GPU timestamp for pass end in ns (timestamp-query mode only). */
  gpuEndNs?: number;
  /** GPU pass duration in ns (timestamp-query mode only). */
  gpuElapsedNs?: number;
}

export interface GPUMemoryAllocation {
  size: number;
  usage: string;
  label?: string;
  type?: 'buffer' | 'texture' | 'textureView';
  alive?: boolean;
}

/**
 * GPU memory statistics.
 *
 * `memorySource` indicates the provenance of `usedHeapSize` so consumers can
 * gauge data quality:
 *  - `'cdp'`      — `Performance.getMetrics` reported `GPUMemoryUsedKB` (most accurate)
 *  - `'tracked'`  — CDP metric unavailable; value is the sum of live WeakRef-tracked allocations (lower bound)
 *  - `'estimated'`— no tracked allocations either; value is a conservative fallback
 *
 * `trackedBytes` exposes the raw sum of tracked allocation sizes regardless of source.
 */
export interface GPUMemoryStats {
  heapSize: number;
  usedHeapSize: number;
  allocations: GPUMemoryAllocation[];
  memorySource: 'cdp' | 'tracked' | 'estimated';
  trackedBytes: number;
}

export interface WebGPUDomainDependencies {
  pageController?: {
    getActivePage(): Promise<any>;
  };
}
