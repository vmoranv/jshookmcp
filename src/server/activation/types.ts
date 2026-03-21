/**
 * Types for the State-Driven Auto-Boost & Intelligence activation system.
 *
 * Supports event-pattern boost rules, inactivity-based prune rules,
 * and configurable controller options.
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

export interface PruneRule {
  /** Domain to prune */
  domain: string;
  /** Prune after this many ms of inactivity */
  inactivityMs: number;
}

export interface ActivationControllerOptions {
  /** Boost cool-down period in ms (default 30000) */
  cooldownMs?: number;
  /** Enable platform-based tool filtering (default true) */
  platformFilter?: boolean;
  /** Custom boost rules (extends defaults) */
  boostRules?: BoostRule[];
  /** Custom prune rules (extends defaults) */
  pruneRules?: PruneRule[];
}

/** Record of an event occurrence for sliding-window evaluation. */
export interface EventRecord {
  event: string;
  timestamp: number;
  payload?: unknown;
}
