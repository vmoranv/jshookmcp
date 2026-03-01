import type { RuntimeInspector } from './RuntimeInspector.js';
import { logger } from '../../utils/logger.js';

type WatchValue = unknown;

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
  private watches: Map<string, WatchExpression> = new Map();
  private watchCounter = 0;

  constructor(private runtimeInspector: RuntimeInspector) {}

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

  async evaluateAll(callFrameId?: string, timeout = 5000): Promise<WatchResult[]> {
    const results: WatchResult[] = [];

    for (const watch of this.watches.values()) {
      if (!watch.enabled) continue;

      try {
        const value: WatchValue = await Promise.race([
          this.runtimeInspector.evaluate(watch.expression, callFrameId),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Evaluation timeout after ${timeout}ms`)), timeout)
          ),
        ]);

        const valueChanged = !this.deepEqual(value, watch.lastValue);

        if (valueChanged) {
          watch.valueHistory.push({
            value,
            timestamp: Date.now(),
          });

          if (watch.valueHistory.length > 100) {
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
    if (a == null || b == null) return false;
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
