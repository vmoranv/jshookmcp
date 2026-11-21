/**
 * ToolCallContextGuard — facade over the three independent concerns that used
 * to share one class:
 *
 * - `TabContextEnricher`: inject `_tabContext` into context-sensitive responses.
 * - `CallLoopDetector`: repeat / doom-loop / isomorphic-call detection.
 * - `ExecutionBudgetTracker`: sliding-window execution-cost (gas) accounting.
 *
 * The permission gate lives in `./context/ToolExecutionGate` and is re-exported
 * below so every existing import path keeps working.
 */
import { CallLoopDetector } from './context/CallLoopDetector';
import { ExecutionBudgetTracker } from './context/ExecutionBudgetTracker';
import { TabContextEnricher, type TabContextProvider } from './context/TabContextEnricher';
import type {
  DoomLoopTrip,
  GasBudgetConfig,
  GasBudgetTrip,
  IsomorphicTrip,
} from './context/ToolExecutionGate';

export class ToolCallContextGuard {
  private readonly enricher: TabContextEnricher;
  private readonly loopDetector = new CallLoopDetector();
  private readonly budgetTracker = new ExecutionBudgetTracker();

  constructor(getProvider: () => TabContextProvider | null) {
    this.enricher = new TabContextEnricher(getProvider);
  }

  /** Check whether a tool name belongs to a context-sensitive domain. */
  isContextSensitive(toolName: string): boolean {
    return this.enricher.isContextSensitive(toolName);
  }

  /**
   * Record a tool call for repeat detection.
   * Call this BEFORE enrichResponse for accurate tracking.
   * Returns the current consecutive count (1 = first call).
   */
  recordCall(toolName: string): number {
    return this.loopDetector.recordCall(toolName);
  }

  /** Check if the current call is a suspected repeat loop. */
  isRepeatLoop(): boolean {
    return this.loopDetector.isRepeatLoop();
  }

  /**
   * Record one tool call in the doom-loop tracker and report whether it
   * tripped the circuit breaker.
   */
  recordDoomLoopCall(toolName: string, argsJson: string, threshold?: number): DoomLoopTrip | null {
    return this.loopDetector.recordDoomLoopCall(toolName, argsJson, threshold);
  }

  /** Test hook: clear all doom-loop counters across sessions. */
  resetDoomLoopStatesForTesting(): void {
    this.loopDetector.resetDoomLoopStatesForTesting();
  }

  /**
   * Record tool execution complexity units against a sliding-window Gas budget.
   * If accumulated units exceed maxWindowUnits, returns trip details.
   */
  recordExecutionCost(toolName: string, config?: GasBudgetConfig): GasBudgetTrip | null {
    return this.budgetTracker.recordExecutionCost(toolName, config);
  }

  /**
   * Record tool call with normalized semantic arguments (isomorphic loop
   * detection). Catches agents that mutate cosmetic/ephemeral parameters.
   */
  recordIsomorphicCall(
    toolName: string,
    args: Record<string, unknown>,
    threshold?: number,
  ): IsomorphicTrip | null {
    return this.loopDetector.recordIsomorphicCall(toolName, args, threshold);
  }

  /** Test hook: clear all gas and isomorphic counters across sessions. */
  resetExecutionBudgetForTesting(): void {
    this.budgetTracker.resetForTesting();
    this.loopDetector.resetIsomorphicStatesForTesting();
  }

  /**
   * Enrich a successful tool response with `_tabContext` metadata and inject a
   * repeat warning when the current call is a suspected loop.
   */
  enrichResponse<T extends { content?: unknown[]; isError?: boolean }>(
    toolName: string,
    response: T,
  ): T {
    return this.enricher.enrichResponse(toolName, response, {
      isRepeatLoop: this.loopDetector.isRepeatLoop(),
      repeatCount: this.loopDetector.getRepeatCount(),
    });
  }
}

export * from './context/ToolExecutionGate';
