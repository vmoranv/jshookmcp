/**
 * PredictiveBooster — analyzes LLM tool call history to pre-load likely next tools.
 *
 * Maintains a simple Markov transition table from tool call sequences.
 * When a tool is called, predicts the most likely next tools based on
 * historical transition frequencies and suggests pre-activation.
 *
 * Requirement addressed: BOOST-06
 */

export class PredictiveBooster {
  /** Sliding window of recent tool calls. */
  private readonly callHistory: string[] = [];
  private readonly maxHistory: number;
  private readonly confidenceThreshold: number;

  /** Markov transition table: toolA → (toolB → count). */
  private readonly transitions = new Map<string, Map<string, number>>();

  constructor(maxHistory = 50, confidenceThreshold = 0.3) {
    this.maxHistory = maxHistory;
    this.confidenceThreshold = confidenceThreshold;
  }

  /**
   * Record a tool call and update the transition table.
   */
  recordCall(toolName: string): void {
    const previous = this.callHistory.length > 0
      ? this.callHistory[this.callHistory.length - 1]
      : null;

    this.callHistory.push(toolName);

    // Trim sliding window
    if (this.callHistory.length > this.maxHistory) {
      this.callHistory.splice(0, this.callHistory.length - this.maxHistory);
    }

    // Update transition table: previous → current
    if (previous) {
      let targets = this.transitions.get(previous);
      if (!targets) {
        targets = new Map<string, number>();
        this.transitions.set(previous, targets);
      }
      targets.set(toolName, (targets.get(toolName) ?? 0) + 1);
    }
  }

  /**
   * Predict the next likely tools based on transition history.
   * Returns tool names with confidence above threshold, sorted by confidence desc.
   */
  predictNext(currentTool: string): string[] {
    const targets = this.transitions.get(currentTool);
    if (!targets) return [];

    // Calculate total transitions from this tool
    let total = 0;
    for (const count of targets.values()) {
      total += count;
    }
    if (total === 0) return [];

    // Collect predictions above confidence threshold
    const predictions: Array<{ tool: string; confidence: number }> = [];
    for (const [tool, count] of targets.entries()) {
      const confidence = count / total;
      if (confidence >= this.confidenceThreshold) {
        predictions.push({ tool, confidence });
      }
    }

    // Sort by confidence descending
    predictions.sort((a, b) => b.confidence - a.confidence);

    return predictions.map((p) => p.tool);
  }

  /**
   * Get domains of predicted tools (for pre-activation).
   * Uses a simple heuristic: extract domain from tool name prefix.
   */
  predictNextDomains(currentTool: string, getToolDomain: (name: string) => string | null): string[] {
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

  /** Get the current history length. */
  get historyLength(): number {
    return this.callHistory.length;
  }

  /** Get the number of unique tools in the transition table. */
  get transitionCount(): number {
    return this.transitions.size;
  }

  /** Clear all history and transitions. */
  reset(): void {
    this.callHistory.length = 0;
    this.transitions.clear();
  }
}
