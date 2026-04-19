/**
 * Shared dependencies interface and helper types for network domain sub-handlers.
 *
 * Each sub-handler receives its dependencies via constructor injection
 * rather than inheritance from a base class.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import type { PerformanceMonitor } from '@server/domains/shared/modules';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { DetailedDataManager } from '@utils/DetailedDataManager';

// ── Shared Dependency Interface ──

export interface NetworkHandlerDeps {
  collector: CodeCollector;
  consoleMonitor: ConsoleMonitor;
  eventBus?: EventBus<ServerEventMap>;
}

// ── Shared Helpers ──

export function getDetailedDataManager(): DetailedDataManager {
  return DetailedDataManager.getInstance();
}

/** Create a lazy PerformanceMonitor factory. Avoids importing the class eagerly. */
export function createPerformanceMonitorFactory(
  factory: () => PerformanceMonitor,
): () => PerformanceMonitor {
  let instance: PerformanceMonitor | null = null;
  return () => {
    if (!instance) {
      instance = factory();
    }
    return instance;
  };
}

export function emitEvent(
  eventBus: EventBus<ServerEventMap> | undefined,
  event: keyof ServerEventMap,
  payload: ServerEventMap[keyof ServerEventMap],
): void {
  void eventBus?.emit(event as never, payload);
}

// ── Shared Arg Parsing Helpers ──

export function parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return defaultValue;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
}

export function parseNumberArg(
  value: unknown,
  options: { defaultValue: number; min?: number; max?: number; integer?: boolean },
): number {
  let parsed: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    parsed = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) {
        parsed = n;
      }
    }
  }
  if (parsed === undefined) {
    parsed = options.defaultValue;
  }
  if (options.integer) {
    parsed = Math.trunc(parsed);
  }
  if (typeof options.min === 'number') {
    parsed = Math.max(options.min, parsed);
  }
  if (typeof options.max === 'number') {
    parsed = Math.min(options.max, parsed);
  }
  return parsed;
}
