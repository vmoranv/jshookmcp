/**
 * Cross-platform Memory Manager - Type Definitions
 *
 * Single Source of Truth for memory types shared between
 * BaseMemoryManager and memory sub-modules.
 */

export type {
  MemoryReadResult,
  MemoryWriteResult,
  MemoryScanResult,
  MemoryRegion,
  MemoryProtectionInfo,
  ModuleInfo,
  Platform,
  PatternType,
  MemoryPatch,
} from '@modules/process/memory/types';
