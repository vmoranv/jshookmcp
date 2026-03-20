/**
 * Code Injector types.
 * @module CodeInjector.types
 */

export interface PatchOperation {
  id: string;
  pid: number;
  address: string;
  originalBytes: number[];
  patchBytes: number[];
  isApplied: boolean;
  timestamp: number;
}

export interface CodeCave {
  address: string;
  size: number;
  module: string;
  section: string;
}
