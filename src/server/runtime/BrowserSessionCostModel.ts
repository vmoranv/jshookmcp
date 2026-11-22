/** Per-tool service-time model used by the browser session scheduler. */

export interface BrowserSessionToolCostStats {
  estimateMs: number;
  samples: number;
}

export const DEFAULT_COST_MS = 250;
export const MIN_COST_MS = 1;
export const MAX_COST_MS = 30_000;

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export class BrowserSessionCostModel {
  private readonly toolCosts = new Map<string, BrowserSessionToolCostStats>();

  get size(): number {
    return this.toolCosts.size;
  }

  estimate(toolName: string | undefined, costHintMs: number | undefined): number {
    const normalizedName = toolName?.trim();
    const observed = normalizedName ? this.toolCosts.get(normalizedName)?.estimateMs : undefined;
    const hint =
      typeof costHintMs === 'number' && Number.isFinite(costHintMs) && costHintMs > 0
        ? costHintMs
        : undefined;
    const estimate = observed ?? hint ?? DEFAULT_COST_MS;
    return clamp(estimate, MIN_COST_MS, MAX_COST_MS);
  }

  update(toolName: string, serviceMs: number, alpha: number): void {
    const previous = this.toolCosts.get(toolName);
    if (!previous) {
      this.toolCosts.set(toolName, { estimateMs: roundMetric(serviceMs), samples: 1 });
      return;
    }
    previous.estimateMs = roundMetric(alpha * serviceMs + (1 - alpha) * previous.estimateMs);
    previous.samples += 1;
  }

  getStats(toolName: string): BrowserSessionToolCostStats | null {
    const state = this.toolCosts.get(toolName);
    return state ? { ...state } : null;
  }
}
