/**
 * HeapAnalyzer type definitions.
 * @module HeapAnalyzer.types
 */

/** Information about a single heap in a process */
export interface HeapInfo {
  /** Heap ID as hex string */
  heapId: string;
  /** Process ID */
  processId: number;
  /** Heap flags (HF32_DEFAULT=1, etc.) */
  flags: number;
  /** Whether this is the default process heap */
  isDefault: boolean;
  /** Number of blocks in this heap */
  blockCount: number;
  /** Total allocated size (bytes) */
  totalSize: number;
}

/** Individual heap block entry */
export interface HeapBlock {
  /** Block address as hex string */
  address: string;
  /** Block size in bytes */
  size: number;
  /** Block flags (LF32_FIXED=1, LF32_FREE=2, LF32_MOVEABLE=4) */
  flags: number;
  /** Parent heap ID */
  heapId: string;
  /** Whether the block is free */
  isFree: boolean;
}

/** Heap statistics for a process */
export interface HeapStats {
  /** Number of heaps */
  totalHeaps: number;
  /** Total block count across all heaps */
  totalBlocks: number;
  /** Total allocated size (bytes) */
  totalSize: number;
  /** Total free size (bytes) */
  freeSize: number;
  /** Total used size (bytes) */
  usedSize: number;
  /** Largest single block size */
  largestBlock: number;
  /** Smallest non-free block size */
  smallestBlock: number;
  /** Average block size */
  averageBlockSize: number;
  /** Size distribution buckets */
  sizeDistribution: HeapSizeBucket[];
  /** Fragmentation ratio (freeSize / totalSize), 0-1 */
  fragmentationRatio: number;
}

/** Size distribution bucket */
export interface HeapSizeBucket {
  /** Human-readable range label */
  range: string;
  /** Number of blocks in this range */
  count: number;
  /** Total bytes in this range */
  totalBytes: number;
}

/** Types of heap anomalies */
export type HeapAnomalyType =
  | 'heap_spray_pattern'
  | 'possible_uaf'
  | 'suspicious_size'
  | 'possible_double_free'
  | 'guard_page_missing';

/** Detected heap anomaly */
export interface HeapAnomaly {
  /** Anomaly type */
  type: HeapAnomalyType;
  /** Severity level */
  severity: 'low' | 'medium' | 'high';
  /** Relevant address */
  address: string;
  /** Human-readable description */
  details: string;
  /** Parent heap ID */
  heapId: string;
}

/** Heap block flags */
export const LF32 = {
  FIXED: 0x00000001,
  FREE: 0x00000002,
  MOVEABLE: 0x00000004,
} as const;

/** Heap flags */
export const HF32 = {
  DEFAULT: 0x00000001,
  SHARED: 0x00000002,
} as const;
