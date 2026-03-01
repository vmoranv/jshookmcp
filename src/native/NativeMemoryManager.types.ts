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

export type NativePatternType = 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string';
