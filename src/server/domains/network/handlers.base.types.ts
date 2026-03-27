/**
 * Shared types, constants, and type-guard utilities for the network domain handlers.
 */

import { DetailedDataManager } from '@utils/DetailedDataManager';

// ── Constants ──

/** Resource types excluded by default when no explicit filters are set. */
export const EXCLUDED_RESOURCE_TYPES = new Set([
  'Image',
  'Font',
  'Stylesheet',
  'Media',
  'Manifest',
  'Ping',
]);

/** Priority order for smart sorting (lower = higher priority). */
export const TYPE_SORT_PRIORITY: Record<string, number> = {
  XHR: 0,
  Fetch: 1,
  Document: 2,
  Script: 3,
  WebSocket: 4,
  EventSource: 5,
};
export const DEFAULT_SORT_PRIORITY = 6;

// ── Helper Types ──

export interface NetworkRequestPayload {
  requestId?: string;
  url: string;
  method: string;
  type?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface NetworkResponsePayload {
  status: number;
  [key: string]: unknown;
}

// ── CPU Profile Types ──

export interface CpuProfileCallFramePayload {
  functionName?: string;
  url?: string;
  lineNumber?: number;
}

export interface CpuProfileNodePayload {
  hitCount?: number;
  callFrame?: CpuProfileCallFramePayload;
}

export interface CpuProfilePayload {
  nodes: CpuProfileNodePayload[];
  samples?: unknown[];
  startTime: number;
  endTime: number;
}

// ── Type Guards ──

export const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isNetworkRequestPayload = (value: unknown): value is NetworkRequestPayload => {
  if (!isObjectRecord(value)) {
    return false;
  }
  return typeof value.url === 'string' && typeof value.method === 'string';
};

export const isNetworkResponsePayload = (value: unknown): value is NetworkResponsePayload => {
  if (!isObjectRecord(value)) {
    return false;
  }
  return typeof value.status === 'number';
};

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const asOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

export const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const asOptionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === 'string') ? value : undefined;
};

export const isCpuProfileNodePayload = (value: unknown): value is CpuProfileNodePayload => {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.hitCount !== undefined && typeof value.hitCount !== 'number') {
    return false;
  }

  if (value.callFrame !== undefined && !isObjectRecord(value.callFrame)) {
    return false;
  }
  if (isObjectRecord(value.callFrame)) {
    if (
      value.callFrame.functionName !== undefined &&
      typeof value.callFrame.functionName !== 'string'
    ) {
      return false;
    }
    if (value.callFrame.url !== undefined && typeof value.callFrame.url !== 'string') {
      return false;
    }
    if (
      value.callFrame.lineNumber !== undefined &&
      typeof value.callFrame.lineNumber !== 'number'
    ) {
      return false;
    }
  }

  return true;
};

export const toCpuProfilePayload = (value: unknown): CpuProfilePayload | null => {
  if (!isObjectRecord(value)) {
    return null;
  }
  if (!Array.isArray(value.nodes)) {
    return null;
  }
  if (typeof value.startTime !== 'number' || typeof value.endTime !== 'number') {
    return null;
  }
  if (!value.nodes.every((node) => isCpuProfileNodePayload(node))) {
    return null;
  }

  return {
    nodes: value.nodes,
    samples: Array.isArray(value.samples) ? value.samples : undefined,
    startTime: value.startTime,
    endTime: value.endTime,
  };
};

// ── Shared Utility: DetailedDataManager singleton ──

export function getDetailedDataManager(): DetailedDataManager {
  return DetailedDataManager.getInstance();
}
