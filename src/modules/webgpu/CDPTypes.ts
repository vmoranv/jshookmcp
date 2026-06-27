/**
 * Internal types shared between CDPIntegration.ts, MemoryTracking.ts, and
 * CommandHook.ts. Not intended for external consumption — consumers should
 * import through CDPIntegration.ts (backward-compatible re-export hub).
 */

/**
 * WeakRef-based allocation record kept in the page context.
 */
export interface PageAllocationRecord {
  size: number;
  usage: number;
  label?: string;
  type: 'buffer' | 'texture';
  ref: WeakRef<any>;
}

/**
 * Hook state stored in the page context for recoverable hooks.
 *
 * Shared by MemoryTracking (allocation tracking) and CommandHook (command capture).
 */
export interface PageHookState {
  originalSubmit: typeof GPUQueue.prototype.submit;
  originalCreateCommandEncoder: typeof GPUDevice.prototype.createCommandEncoder;
  hooksInstalled: boolean;
  commandTrace: {
    commands: any[];
    totalSubmissions: number;
    startTime: number;
  } | null;
  allocations: PageAllocationRecord[];
}

/** Re-exported via CDPIntegration for backward compatibility. */
export type { GPUCommandTrace } from './CommandHook';
