/**
 * Shared types and state for WASM sub-handlers.
 */

import { resolve, normalize, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { ExternalToolRunner } from '@server/domains/shared/modules';
import type { CodeCollector } from '@server/domains/shared/modules';

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

export interface WasmMemoryInspectEvalSuccess {
  totalMemoryPages: number;
  totalMemoryBytes: number;
  requestedOffset: number;
  requestedLength: number;
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
  typeof value === 'object' && value !== null;

export const hasErrorResult = (value: unknown): value is EvalErrorResult =>
  isRecord(value) && typeof value.error === 'string';

export function validateOutputPath(outputPath: string): string {
  const safe = resolve(outputPath);
  const cwd = normalize(process.cwd());
  const tmp = normalize(tmpdir());
  if (!safe.startsWith(`${cwd}${sep}`) && !safe.startsWith(`${tmp}${sep}`)) {
    throw new Error(
      'Path traversal blocked: outputPath must be under project root or temp directory',
    );
  }
  return safe;
}
