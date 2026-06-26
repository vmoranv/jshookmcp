/**
 * Platform abstraction barrel export.
 *
 * Usage:
 *   import type { PlatformMemoryAPI, ProcessHandle, MemoryRegionInfo } from '@native/platform';
 *
 * @module platform
 */

export type { PlatformMemoryAPI } from './PlatformMemoryAPI.js';
export { createPlatformProvider, getCurrentPlatform } from './factory.js';
export { LinuxMemoryProvider, LinuxMemoryProviderImpl } from './linux/index.js';
export {
  MemoryProtection,
  type ProcessHandle,
  type MemoryRegionInfo,
  type MemoryRegionState,
  type MemoryRegionType,
  type ModuleInfo,
  type MemoryReadResult,
  type MemoryWriteResult,
  type ProtectionChangeResult,
  type AllocationResult,
  type PlatformAvailability,
} from './types.js';
export { scanGuardPages } from './GuardPageScanner';
export type { GuardPageResult, GuardPageScanStats, GuardPageScanOutput } from './GuardPageScanner';
export { scanIntegrity } from './IntegrityScanner';
export type {
  IntegritySectionResult,
  IntegrityScanStats,
  IntegrityScanOutput,
} from './IntegrityScanner';
