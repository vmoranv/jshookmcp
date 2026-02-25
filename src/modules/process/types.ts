/**
 * Cross-platform Memory Manager - Type Definitions
 */

export interface MemoryReadResult {
  success: boolean;
  data?: string; // hex encoded
  error?: string;
}

export interface MemoryWriteResult {
  success: boolean;
  bytesWritten?: number;
  error?: string;
}

export interface MemoryScanResult {
  success: boolean;
  addresses: string[]; // hex addresses where pattern was found
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
  type: string;
}

export interface MemoryProtectionInfo {
  success: boolean;
  protection?: string;
  isWritable?: boolean;
  isReadable?: boolean;
  isExecutable?: boolean;
  regionStart?: string;
  regionSize?: number;
  error?: string;
}

export interface ModuleInfo {
  name: string;
  baseAddress: string;
  size: number;
}

export type Platform = 'win32' | 'linux' | 'darwin' | 'unknown';

export type PatternType = 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string';

export interface MemoryPatch {
  address: string;
  data: string;
  encoding?: 'hex' | 'base64';
}

export interface MemoryMonitor {
  pid: number;
  address: string;
  interval: number;
  lastValue: string;
  timer: NodeJS.Timeout;
}
