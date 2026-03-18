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
} from '@modules/process/memory/types';

export { readMemory } from '@modules/process/memory/reader';
export { writeMemory, batchMemoryWrite } from '@modules/process/memory/writer';
export { scanMemory, scanMemoryFiltered } from '@modules/process/memory/scanner';
export {
  dumpMemoryRegion,
  enumerateRegions,
  checkMemoryProtection,
  enumerateModules,
} from '@modules/process/memory/regions';
export { injectDll, injectShellcode } from '@modules/process/memory/injector';
export { MemoryMonitorManager } from '@modules/process/memory/monitor';
export { checkAvailability, checkDebugPort } from '@modules/process/memory/availability';
