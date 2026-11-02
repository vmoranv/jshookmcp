import type { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import { logger } from '@utils/logger';
import { WATCH_EVAL_TIMEOUT_MS, WATCH_MAX_HISTORY } from '@src/constants';

type WatchValue = unknown;

/**
 * One deep-equality strategy for a non-plain container type.
 *
 * `matches` is applied to BOTH operands, so a Map is only compared as a Map
 * when the other side is also a Map — mixed types fall through to the generic
 * record comparison (which rejects them, since neither is a plain record of
 * the same shape).
 */
interface ContainerComparator {
  matches: (value: unknown) => boolean;
  /** `recurse` is the owner's deepEqual, needed by Map for its values. */
  equal: (a: unknown, b: unknown, recurse: (x: unknown, y: unknown) => boolean) => boolean;
}

/** Container comparisons, tried in this order before the plain-record path. */
const CONTAINER_COMPARATORS: readonly ContainerComparator[] = [
  {
    matches: (v) => v instanceof Map,
    equal: (a, b, recurse) => {
      const mapA = a as Map<unknown, unknown>;
      const mapB = b as Map<unknown, unknown>;
      if (mapA.size !== mapB.size) return false;
      for (const [key, value] of mapA) {
        if (!mapB.has(key) || !recurse(value, mapB.get(key))) return false;
      }
      return true;
    },
  },
  {
    matches: (v) => v instanceof Set,
    equal: (a, b) => {
      const setA = a as Set<unknown>;
      const setB = b as Set<unknown>;
      if (setA.size !== setB.size) return false;
      for (const item of setA) {
        if (!setB.has(item)) return false;
      }
      return true;
    },
  },
  {
    matches: (v) => v instanceof RegExp,
    equal: (a, b) =>
      (a as RegExp).source === (b as RegExp).source && (a as RegExp).flags === (b as RegExp).flags,
  },
  {
    matches: (v) => v instanceof Date,
    equal: (a, b) => (a as Date).getTime() === (b as Date).getTime(),
  },
  {
    matches: (v) => v instanceof ArrayBuffer,
    equal: (a, b) => {
      const bufA = a as ArrayBuffer;
      const bufB = b as ArrayBuffer;
      if (bufA.byteLength !== bufB.byteLength) return false;
      const viewA = new Uint8Array(bufA);
      const viewB = new Uint8Array(bufB);
      for (let i = 0; i < viewA.length; i += 1) {
        if (viewA[i] !== viewB[i]) return false;
      }
      return true;
    },
  },
];

interface ValueHistoryEntry {
  value: WatchValue;
  timestamp: number;
}

export interface WatchExpression {
  id: string;
  expression: string;
  name: string;
  enabled: boolean;
  lastValue: WatchValue;
  lastError: Error | null;
  valueHistory: ValueHistoryEntry[];
  createdAt: number;
}

export interface WatchResult {
  watchId: string;
  name: string;
  expression: string;
  value: WatchValue;
  error: Error | null;
  valueChanged: boolean;
  timestamp: number;
}

export class WatchExpressionManager {
  private runtimeInspector: RuntimeInspector;
  private watches: Map<string, WatchExpression> = new Map();
  private watchCounter = 0;

  constructor(runtimeInspector: RuntimeInspector) {
    this.runtimeInspector = runtimeInspector;
  }

  addWatch(expression: string, name?: string): string {
    const watchId = `watch_${++this.watchCounter}`;

    this.watches.set(watchId, {
      id: watchId,
      expression,
      name: name || expression,
      enabled: true,
      lastValue: undefined,
      lastError: null,
      valueHistory: [],
      createdAt: Date.now(),
    });

    logger.info(`Watch expression added: ${watchId}`, { expression, name });
    return watchId;
  }

  removeWatch(watchId: string): boolean {
    const deleted = this.watches.delete(watchId);
    if (deleted) {
      logger.info(`Watch expression removed: ${watchId}`);
    }
    return deleted;
  }

  setWatchEnabled(watchId: string, enabled: boolean): boolean {
    const watch = this.watches.get(watchId);
    if (!watch) return false;

    watch.enabled = enabled;
    logger.info(`Watch expression ${enabled ? 'enabled' : 'disabled'}: ${watchId}`);
    return true;
  }

  getAllWatches(): WatchExpression[] {
    return Array.from(this.watches.values());
  }

  getWatch(watchId: string): WatchExpression | undefined {
    return this.watches.get(watchId);
  }

  async evaluateAll(callFrameId?: string, timeout = WATCH_EVAL_TIMEOUT_MS): Promise<WatchResult[]> {
    const results: WatchResult[] = [];

    for (const watch of this.watches.values()) {
      if (!watch.enabled) continue;

      try {
        // Keep the timeout timer handle so it can be cleared once the
        // evaluation settles — a dangling timer would otherwise keep the
        // event loop (and thus the process) alive until it fires.
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        const value: WatchValue = await Promise.race([
          this.runtimeInspector.evaluate(watch.expression, callFrameId),
          new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(
              () => reject(new Error(`Evaluation timeout after ${timeout}ms`)),
              timeout,
            );
          }),
        ]).finally(() => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
        });

        const valueChanged = !this.deepEqual(value, watch.lastValue);

        if (valueChanged) {
          watch.valueHistory.push({
            value,
            timestamp: Date.now(),
          });

          if (watch.valueHistory.length > WATCH_MAX_HISTORY) {
            watch.valueHistory.shift();
          }
        }

        watch.lastValue = value;
        watch.lastError = null;

        results.push({
          watchId: watch.id,
          name: watch.name,
          expression: watch.expression,
          value,
          error: null,
          valueChanged,
          timestamp: Date.now(),
        });
      } catch (error) {
        watch.lastError = error as Error;

        results.push({
          watchId: watch.id,
          name: watch.name,
          expression: watch.expression,
          value: null,
          error: error as Error,
          valueChanged: false,
          timestamp: Date.now(),
        });
      }
    }

    return results;
  }

  clearAll(): void {
    this.watches.clear();
    logger.info('All watch expressions cleared');
  }

  getValueHistory(watchId: string): ValueHistoryEntry[] | null {
    const watch = this.watches.get(watchId);
    return watch ? watch.valueHistory : null;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;

    // Non-plain containers need explicit comparisons — Object.keys() on a Map
    // or RegExp is empty, which used to make any two instances "equal" and
    // silently suppressed valueChanged notifications. Each container kind is
    // tried in a fixed order; the first one whose type guard accepts BOTH
    // operands owns the verdict.
    const container = CONTAINER_COMPARATORS.find((c) => c.matches(a) && c.matches(b));
    if (container) {
      return container.equal(a, b, (x, y) => this.deepEqual(x, y));
    }

    if (!this.isRecord(a) || !this.isRecord(b)) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!this.deepEqual(a[key], b[key])) return false;
    }

    return true;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  exportWatches(): Array<{ expression: string; name: string; enabled: boolean }> {
    return Array.from(this.watches.values()).map((watch) => ({
      expression: watch.expression,
      name: watch.name,
      enabled: watch.enabled,
    }));
  }

  importWatches(watches: Array<{ expression: string; name?: string; enabled?: boolean }>): void {
    for (const watch of watches) {
      const watchId = this.addWatch(watch.expression, watch.name);
      if (watch.enabled === false) {
        this.setWatchEnabled(watchId, false);
      }
    }
    logger.info(`Imported ${watches.length} watch expressions`);
  }
}
