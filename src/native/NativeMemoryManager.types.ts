export interface NativeMemoryReadResult {
  success: boolean;
  data?: string; // hex encoded
  error?: string;
}

export interface NativeMemoryWriteResult {
  success: boolean;
  bytesWritten?: number;
  error?: string;
}

export interface NativeMemoryScanResult {
  success: boolean;
  addresses: string[];
  error?: string;
  stats?: {
    patternLength: number;
    resultsFound: number;
  };
}

export interface MemoryRegion {
  baseAddress: string;
  size: number;
  state: string;
  protection: string;
  isReadable: boolean;
  isWritable: boolean;
  isExecutable: boolean;
  type: string;
}

export interface ModuleInfo {
  name: string;
  baseAddress: string;
  size: number;
}

export type NativePatternType =
  | 'hex'
  | 'string'
  | 'byte'
  | 'int8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float'
  | 'double'
  | 'pointer';

// ── Scan engine types ──

/** Value types supported by the CE-style iterative scan engine. */
export type ScanValueType =
  | 'byte'
  | 'int8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float'
  | 'double'
  | 'pointer'
  | 'hex'
  | 'string';

/** Comparison modes for next-scan narrowing. */
export type ScanCompareMode =
  | 'exact'
  | 'unknown_initial'
  | 'changed'
  | 'unchanged'
  | 'increased'
  | 'decreased'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'not_equal';

/** Options bag for first-scan and unknown-initial-scan. */
export interface ScanOptions {
  valueType: ScanValueType;
  alignment?: number;
  maxResults?: number;
  regionFilter?: {
    writable?: boolean;
    executable?: boolean;
    moduleOnly?: boolean;
  };
  onProgress?: (progress: number, total?: number) => void;
}

/** Internal state for a live scan session. */
export interface ScanSessionState {
  id: string;
  pid: number;
  valueType: ScanValueType;
  alignment: number;
  createdAt: number;
  lastScanAt: number;
  scanCount: number;
  /** Addresses stored as bigint internally to avoid GC overhead from string conversion. */
  addresses: bigint[];
  /** Previous scan values keyed by bigint address. */
  previousValues: Map<bigint, Buffer>;
}
