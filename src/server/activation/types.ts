/**
 * Types for the State-Driven Auto-Boost & Intelligence activation system.
 *
 * Supports event-pattern boost rules and configurable controller options.
 */

export interface BoostRule {
  /** Event pattern to match (event name prefix or exact match) */
  eventPattern: string;
  /** Domain(s) to boost when pattern matches */
  targetDomains: string[];
  /** Minimum events in window to trigger boost */
  threshold: number;
  /** Time window in ms for counting events */
  windowMs: number;
  /** Priority (higher = applied first) */
  priority: number;
}

export interface ActivationControllerOptions {
  /** Boost cool-down period in ms (default 30000) */
  cooldownMs?: number;
  /**
   * Custom boost rules (extends defaults). `eventPattern` is a prefix: rules
   * are evaluated against every emitted event, so `debugger:` matches
   * `debugger:breakpoint_hit` as well as the exact name.
   */
  boostRules?: BoostRule[];
}

/** Record of an event occurrence for sliding-window evaluation. */
export interface EventRecord {
  event: string;
  timestamp: number;
  payload?: unknown;
}
