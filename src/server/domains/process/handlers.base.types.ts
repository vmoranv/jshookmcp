/**
 * Shared types, interfaces and standalone helper functions for the process domain.
 */

import type { AuditEntry } from '@modules/process/memory/AuditTrail';

// Re-export for consumers
export type { AuditEntry };

export interface ProcessSummarySource {
  pid: number;
  name: string;
  executablePath?: string;
  windowTitle?: string;
  windowHandle?: string;
  memoryUsage?: number;
}

export interface ProcessWindowSource {
  handle: string;
  title: string;
  className: string;
  processId: number;
}

export interface MemoryDiagnosticsInput {
  pid?: number;
  address?: string;
  size?: number;
  operation: string;
  error?: string;
}

export interface MemoryDiagnostics {
  permission: {
    available: boolean;
    reason?: string;
    platform: string;
  };
  process: {
    exists: boolean | null;
    pid: number | null;
    name: string | null;
  };
  address: {
    queried: boolean;
    valid: boolean | null;
    protection: string | null;
    regionStart: string | null;
    regionSize: number | null;
  };
  aslr: {
    heuristic: true;
    note: string;
  };
  recommendedActions: string[];
}

export type MemoryPatternType = 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string';
export type BinaryEncoding = 'hex' | 'base64';
export type InjectionValidationModeOverride = 'strict' | 'balanced' | 'permissive' | 'disabled';

const MEMORY_PATTERN_TYPES: Set<MemoryPatternType> = new Set([
  'hex',
  'int32',
  'int64',
  'float',
  'double',
  'string',
]);

/** Validate an arg is a positive integer PID. */
export function validatePid(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid PID: ${JSON.stringify(value)}`);
  return n;
}

/** Validate an arg is a non-empty string. */
export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

/** Validate an arg is a positive number. */
export function requirePositiveNumber(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

export function parseOptionalStringArg(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return value.length > 0 ? value : undefined;
}

export function normalizePatternType(value: unknown): MemoryPatternType {
  if (value === undefined || value === null || value === '') {
    return 'hex';
  }
  if (typeof value === 'string' && MEMORY_PATTERN_TYPES.has(value as MemoryPatternType)) {
    return value as MemoryPatternType;
  }
  throw new Error(`patternType must be one of: ${[...MEMORY_PATTERN_TYPES].join(', ')}`);
}

export function getOptionalPid(value: unknown): number | undefined {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function getOptionalBinaryEncoding(value: unknown): BinaryEncoding | undefined {
  return value === 'hex' || value === 'base64' ? value : undefined;
}

export function getOptionalPositiveNumber(value: unknown): number | undefined {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? size : undefined;
}

export function normalizeBinaryEncoding(
  value: unknown,
  fieldName: string,
): BinaryEncoding | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'hex' || value === 'base64') {
    return value;
  }
  throw new Error(`${fieldName} must be "hex" or "base64"`);
}

export function normalizeInjectionValidationMode(
  value: unknown,
  fieldName: string,
): InjectionValidationModeOverride | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === 'strict' ||
    value === 'balanced' ||
    value === 'permissive' ||
    value === 'disabled'
  ) {
    return value;
  }
  throw new Error(`${fieldName} must be one of: strict, balanced, permissive, disabled`);
}

export function getWriteSize(data: string, encoding: BinaryEncoding): number {
  if (encoding === 'hex') {
    const normalized = data.replace(/\s+/g, '');
    return Math.ceil(normalized.length / 2);
  }

  return Buffer.from(data, 'base64').length;
}
