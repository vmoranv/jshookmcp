/**
 * Sliding-window execution cost accounting (the "gas budget").
 *
 * Owns only cost records; loop detection and response enrichment live in
 * sibling modules so each has one reason to change.
 */
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';
import {
  getToolExecutionComplexity,
  type GasBudgetConfig,
  type GasBudgetTrip,
} from './ToolExecutionGate';

export class ExecutionBudgetTracker {
  /** Sliding window execution complexity gas usage records per session. */
  private readonly gasUsage = new Map<string, Array<{ timestamp: number; cost: number }>>();

  /**
   * Record tool execution complexity units against a sliding-window Gas budget.
   * If accumulated units exceed maxWindowUnits, returns trip details.
   */
  recordExecutionCost(toolName: string, config?: GasBudgetConfig): GasBudgetTrip | null {
    const limit = config?.maxWindowUnits ?? 0;
    if (limit <= 0) return null;
    const windowMs = config?.windowMs ?? 60_000;
    const now = Date.now();
    const scope = getToolRequestContext()?.sessionId ?? 'default';

    let records = this.gasUsage.get(scope);
    if (!records) {
      records = [];
      this.gasUsage.set(scope, records);
    }

    const cutoff = now - windowMs;
    const filtered = records.filter((r) => r.timestamp > cutoff);
    const cost = getToolExecutionComplexity(toolName);
    filtered.push({ timestamp: now, cost });
    this.gasUsage.set(scope, filtered);

    const totalUsed = filtered.reduce((sum, r) => sum + r.cost, 0);
    if (totalUsed > limit) {
      const oldest = filtered[0]?.timestamp ?? now;
      const resetInMs = Math.max(0, oldest + windowMs - now);
      return { usedCost: totalUsed, limit, resetInMs };
    }
    return null;
  }

  /** Test hook: clear all gas counters across sessions. */
  resetForTesting(): void {
    this.gasUsage.clear();
  }
}
