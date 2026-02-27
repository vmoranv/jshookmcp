/**
 * Memory sub-module barrel export
 */

export type {
  Platform,
  PatternType,
  MemoryReadResult,
  MemoryWriteResult,
  MemoryScanResult,
  MemoryRegion,
  MemoryProtectionInfo,
  ModuleInfo,
  MemoryPatch,
  MemoryMonitorEntry,
} from './types.js';

export { readMemory } from './reader.js';
export { writeMemory, batchMemoryWrite } from './writer.js';
export { scanMemory, scanMemoryFiltered } from './scanner.js';
export { dumpMemoryRegion, enumerateRegions, checkMemoryProtection, enumerateModules } from './regions.js';
export { injectDll, injectShellcode } from './injector.js';
export { MemoryMonitorManager } from './monitor.js';
export { checkAvailability, checkDebugPort } from './availability.js';
