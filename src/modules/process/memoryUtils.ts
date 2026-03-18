/**
 * Memory utility functions
 * Convenience wrappers for common memory operations
 */

import { MemoryManager } from '@modules/process/MemoryManager';

// Basic operations
export async function scanMemory(
  pid: number,
  pattern: string,
  patternType: 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string' = 'hex'
) {
  const manager = new MemoryManager();
  return manager.scanMemory(pid, pattern, patternType);
}

export async function dumpMemory(pid: number, address: string, size: number, outputPath: string) {
  const manager = new MemoryManager();
  return manager.dumpMemoryRegion(pid, address, size, outputPath);
}

export async function listMemoryRegions(pid: number) {
  const manager = new MemoryManager();
  return manager.enumerateRegions(pid);
}

// Advanced operations
export async function checkProtection(pid: number, address: string) {
  const manager = new MemoryManager();
  return manager.checkMemoryProtection(pid, address);
}

export async function scanFiltered(
  pid: number,
  pattern: string,
  addresses: string[],
  patternType: 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string' = 'hex'
) {
  const manager = new MemoryManager();
  return manager.scanMemoryFiltered(pid, pattern, addresses, patternType);
}

export async function batchWrite(
  pid: number,
  patches: { address: string; data: string; encoding?: 'hex' | 'base64' }[]
) {
  const manager = new MemoryManager();
  return manager.batchMemoryWrite(pid, patches);
}

// Monitoring (returns monitor ID)
export function startMonitor(
  pid: number,
  address: string,
  size: number = 4,
  intervalMs: number = 1000,
  onChange?: (oldValue: string, newValue: string) => void
) {
  const manager = new MemoryManager();
  return manager.startMemoryMonitor(pid, address, size, intervalMs, onChange);
}

export function stopMonitor(monitorId: string) {
  const manager = new MemoryManager();
  return manager.stopMemoryMonitor(monitorId);
}

// Injection
export async function injectDll(pid: number, dllPath: string) {
  const manager = new MemoryManager();
  return manager.injectDll(pid, dllPath);
}

export async function injectShellcode(
  pid: number,
  shellcode: string,
  encoding: 'hex' | 'base64' = 'hex'
) {
  const manager = new MemoryManager();
  return manager.injectShellcode(pid, shellcode, encoding);
}

// Anti-detection
export async function checkDebugPort(pid: number) {
  const manager = new MemoryManager();
  return manager.checkDebugPort(pid);
}

export async function enumerateModules(pid: number) {
  const manager = new MemoryManager();
  return manager.enumerateModules(pid);
}
