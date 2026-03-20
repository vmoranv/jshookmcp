/**
 * Speedhack types.
 * @module Speedhack.types
 */

export interface SpeedhackState {
  pid: number;
  speed: number;
  hookedApis: string[];
  isActive: boolean;
  allocatedMemory?: string;
  patchIds: string[];
}
