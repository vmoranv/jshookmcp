/**
 * PredictiveBooster — analyzes LLM tool call history to pre-load likely next tools.
 *
 * Model:
 *  - First-order Markov transitions (A → B) indexed by the immediate
 *    previous tool name.
 *  - Second-order Markov transitions ((A,B) → C) for richer context when
 *    the session has enough history; falls back to first-order otherwise.
 *  - Exponential decay is applied to every transition weight on each record
 *    so that stale patterns fade out and recent usage dominates predictions.
 *
 * All tuning knobs (history cap, confidence threshold, decay factor) are
 * sourced from `src/constants.ts` and therefore overridable via `.env`.
 *
 * Requirement addressed: BOOST-06
 */

import {
  PREDICTIVE_CONFIDENCE_THRESHOLD,
  PREDICTIVE_DECAY_FACTOR,
  PREDICTIVE_MAX_HISTORY,
  PREDICTIVE_MAX_SECOND_ORDER_KEYS,
} from '@src/constants';

export interface PredictiveBoosterOptions {
  maxHistory?: number;
  confidenceThreshold?: number;
  decayFactor?: number;
  maxSecondOrderKeys?: number;
}

export class PredictiveBooster {
  private readonly callHistory: string[] = [];
  private readonly maxHistory: number;
  private readonly confidenceThreshold: number;
  private readonly decayFactor: number;

  /** First-order transitions: toolA → (toolB → weightedCount). */
  private readonly transitions = new Map<string, Map<string, number>>();

  /** Second-order transitions: (toolA|toolB) → (toolC → weightedCount). */
  private readonly transitions2 = new Map<string, Map<string, number>>();

  /** Guards transitions2 from unbounded growth. */
  private readonly maxSecondOrderKeys: number;

  constructor(options: PredictiveBoosterOptions = {}) {
    this.maxHistory = options.maxHistory ?? PREDICTIVE_MAX_HISTORY;
    this.confidenceThreshold = options.confidenceThreshold ?? PREDICTIVE_CONFIDENCE_THRESHOLD;
    this.decayFactor = options.decayFactor ?? PREDICTIVE_DECAY_FACTOR;
    this.maxSecondOrderKeys = options.maxSecondOrderKeys ?? PREDICTIVE_MAX_SECOND_ORDER_KEYS;
  }

  /**
   * Record a tool call and update both transition tables.
   */
  recordCall(toolName: string): void {
    const previous =
      this.callHistory.length > 0 ? this.callHistory[this.callHistory.length - 1] : null;
    const prevPrev =
      this.callHistory.length > 1 ? this.callHistory[this.callHistory.length - 2] : null;

    this.callHistory.push(toolName);
    if (this.callHistory.length > this.maxHistory) {
      this.callHistory.splice(0, this.callHistory.length - this.maxHistory);
    }

    // Exponential decay keeps the tables biased toward recent behavior.
    this.applyDecay(this.transitions);
    this.applyDecay(this.transitions2);

    if (previous) {
      this.bumpTransition(this.transitions, previous, toolName);
    }
    if (prevPrev && previous) {
      const key = `${prevPrev}\u0001${previous}`;
      this.bumpTransition(this.transitions2, key, toolName);
      this.enforceSecondOrderCap();
    }
  }

  /**
   * Predict the next likely tools based on transition history.
   * Prefers the second-order table when a prediction is available; otherwise
   * falls back to first-order. Returns tool names above the confidence
   * threshold, sorted by probability descending.
   */
  predictNext(currentTool: string): string[] {
    const prev = this.callHistory.length > 1 ? this.callHistory[this.callHistory.length - 2] : null;

    if (prev) {
      const secondKey = `${prev}\u0001${currentTool}`;
      const secondTargets = this.transitions2.get(secondKey);
      const secondPredictions = this.pickPredictions(secondTargets);
      if (secondPredictions.length > 0) {
        return secondPredictions;
      }
    }

    return this.pickPredictions(this.transitions.get(currentTool));
  }

  /**
   * Get domains of predicted tools (for pre-activation).
   */
  predictNextDomains(
    currentTool: string,
    getToolDomain: (name: string) => string | null,
  ): string[] {
    const predictedTools = this.predictNext(currentTool);
    const domains = new Set<string>();

    for (const tool of predictedTools) {
      const domain = getToolDomain(tool);
      if (domain) {
        domains.add(domain);
      }
    }

    return [...domains];
  }

  /** Current history length. */
  get historyLength(): number {
    return this.callHistory.length;
  }

  /** Unique source states in the first-order transition table. */
  get transitionCount(): number {
    return this.transitions.size;
  }

  /** Unique context keys in the second-order transition table. */
  get secondOrderTransitionCount(): number {
    return this.transitions2.size;
  }

  /** Clear all history and transitions. */
  reset(): void {
    this.callHistory.length = 0;
    this.transitions.clear();
    this.transitions2.clear();
  }

  // ── internals ──

  private applyDecay(table: Map<string, Map<string, number>>): void {
    if (this.decayFactor >= 1) return;
    for (const [, targets] of table) {
      for (const [tool, weight] of targets) {
        const decayed = weight * this.decayFactor;
        if (decayed < 0.01) {
          targets.delete(tool);
        } else {
          targets.set(tool, decayed);
        }
      }
    }
  }

  private bumpTransition(
    table: Map<string, Map<string, number>>,
    source: string,
    target: string,
  ): void {
    let targets = table.get(source);
    if (!targets) {
      targets = new Map<string, number>();
      table.set(source, targets);
    }
    targets.set(target, (targets.get(target) ?? 0) + 1);
  }

  private enforceSecondOrderCap(): void {
    if (this.transitions2.size <= this.maxSecondOrderKeys) return;
    const overflow = this.transitions2.size - this.maxSecondOrderKeys;
    const iter = this.transitions2.keys();
    for (let i = 0; i < overflow; i++) {
      const { value, done } = iter.next();
      if (done || !value) break;
      this.transitions2.delete(value);
    }
  }

  private pickPredictions(targets: Map<string, number> | undefined): string[] {
    if (!targets || targets.size === 0) return [];

    let total = 0;
    for (const count of targets.values()) total += count;
    if (total === 0) return [];

    const predictions: Array<{ tool: string; confidence: number }> = [];
    for (const [tool, count] of targets) {
      const confidence = count / total;
      if (confidence >= this.confidenceThreshold) {
        predictions.push({ tool, confidence });
      }
    }

    predictions.sort((a, b) => b.confidence - a.confidence);
    return predictions.map((p) => p.tool);
  }
}
