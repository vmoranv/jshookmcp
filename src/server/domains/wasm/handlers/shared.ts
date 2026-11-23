/**
 * Shared types and state for WASM sub-handlers.
 */

import { ExternalToolRunner } from '@modules/external/ExternalToolRunner';
import { getSafeOutputRoots } from '@utils/outputPaths';
import { resolveSafeOutputPath } from '@utils/safeOutput';
import type { CodeCollector } from '@server/domains/shared/modules/collector';

export type UnknownRecord = Record<string, unknown>;

export interface EvalErrorResult {
  error: string;
}

export interface WasmDumpEvalSuccess {
  exports: unknown;
  importMods: unknown;
  size: unknown;
  moduleCount: number;
}

export type WasmDumpEvalResult = EvalErrorResult | WasmDumpEvalSuccess;

export interface WasmTraceTopFunction {
  name: string;
  count: number;
}

export interface WasmTraceEventPreview {
  mod: unknown;
  fn: unknown;
  args: unknown;
  ts: unknown;
}

export interface WasmVmpTraceEvalSuccess {
  totalEvents: number;
  capturedEvents: number;
  topFunctions: WasmTraceTopFunction[];
  trace: WasmTraceEventPreview[];
}

export type WasmVmpTraceEvalResult = EvalErrorResult | WasmVmpTraceEvalSuccess;

export interface WasmMemorySearchResult {
  offset: number;
}

/** Inventory entry for one captured WASM instance. */
export interface WasmInstanceInfo {
  idx: number;
  exports: string[];
  hasMemory: boolean;
}

export interface WasmMemoryInspectEvalSuccess {
  totalMemoryPages: number;
  totalMemoryBytes: number;
  requestedOffset: number;
  requestedLength: number;
  /** Which instance was read (0-based). */
  instanceIndex: number;
  /** Total number of captured WASM instances on the page. */
  totalInstances: number;
  /** Inventory of every instance, so callers can target a different one. */
  availableInstances: WasmInstanceInfo[];
  data: number[];
  searchResults?: WasmMemorySearchResult[];
  memoryInfo: unknown;
}

export type WasmMemoryInspectEvalResult = EvalErrorResult | WasmMemoryInspectEvalSuccess;

export interface WasmSharedState {
  collector: CodeCollector;
  runner: ExternalToolRunner;
}

export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const hasErrorResult = (value: unknown): value is EvalErrorResult =>
  isRecord(value) && typeof value.error === 'string';

/**
 * Validate an output path against the project root / temp directory, with
 * symlink-aware containment. The previous `startsWith` check could be bypassed
 * by a symlink planted inside a root but pointing outside it, and by
 * parent-directory segments.
 */
export async function validateOutputPath(outputPath: string): Promise<string> {
  try {
    return await resolveSafeOutputPath(outputPath, {
      allowedRoots: getSafeOutputRoots(),
      allowedRootsDescription: 'project root or temp directory',
    });
  } catch (error) {
    throw new Error(
      `Path traversal blocked: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
