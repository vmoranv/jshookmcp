/**
 * Memory Controller types.
 * @module MemoryController.types
 */

export interface FreezeEntry {
  id: string;
  pid: number;
  address: string;
  value: number[];
  valueType: string;
  intervalMs: number;
  isActive: boolean;
}

export interface WriteHistoryEntry {
  id: string;
  pid: number;
  address: string;
  oldValue: number[];
  newValue: number[];
  timestamp: number;
  undone: boolean;
}
