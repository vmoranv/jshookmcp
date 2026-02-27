/**
 * Shared types and utility helpers for the memory sub-modules.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(exec);
export const execFileAsync = promisify(execFile);

export type Platform = 'win32' | 'linux' | 'darwin' | 'unknown';

export type PatternType = 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string';

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

export interface MemoryPatch {
  address: string;
  data: string;
  encoding?: 'hex' | 'base64';
}

export interface MemoryMonitorEntry {
  pid: number;
  address: string;
  interval: number;
  lastValue: string;
  timer: NodeJS.Timeout;
}

// ---------------------------------------------------------------------------
// PowerShell helpers (shared across reader, writer, scanner, regions, injector)
// ---------------------------------------------------------------------------

function getPowerShellExecutable(): string {
  return process.platform === 'win32' ? 'powershell.exe' : 'powershell';
}

export async function executePowerShellScript(
  script: string,
  options: { maxBuffer?: number; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand];
  const { stdout, stderr } = await execFileAsync(getPowerShellExecutable(), args, {
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    timeout: options.timeout,
    windowsHide: true,
  });

  return {
    stdout: String(stdout ?? ''),
    stderr: String(stderr ?? ''),
  };
}
