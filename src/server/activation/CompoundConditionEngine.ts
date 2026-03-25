/**
 * CompoundConditionEngine — multi-stage context awareness for domain boosting.
 *
 * Evaluates compound conditions (AND logic) across multiple state dimensions
 * (platform, active domains, event history, recent tool calls) to determine
 * which domains should be boosted.
 *
 * Requirement addressed: BOOST-05
 */
import type { EventRecord } from './types';

export type ConditionPredicate =
  | { type: 'platform'; value: NodeJS.Platform }
  | { type: 'domain_active'; domain: string }
  | { type: 'event_count'; event: string; minCount: number; windowMs: number }
  | { type: 'tool_called_recently'; toolName: string; withinMs: number };

export interface CompoundCondition {
  /** Unique identifier */
  id: string;
  /** Display name for logging */
  name: string;
  /** ALL conditions must be true (AND logic) */
  conditions: ConditionPredicate[];
  /** Domains to boost when all conditions met */
  boostDomains: string[];
  /** Priority (higher = checked first) */
  priority: number;
}

/** State snapshot used for condition evaluation. */
export interface ConditionState {
  platform: NodeJS.Platform;
  activeDomains: Set<string>;
  eventHistory: readonly EventRecord[];
  recentToolCalls: readonly string[];
}

/** Default compound rules for common multi-domain workflows. */
const DEFAULT_COMPOUND_CONDITIONS: CompoundCondition[] = [
  {
    id: 'wasm-chrome-macos',
    name: 'WASM inside Chrome on macOS',
    conditions: [
      { type: 'platform', value: 'darwin' },
      { type: 'domain_active', domain: 'browser' },
      { type: 'event_count', event: 'tool:called', minCount: 2, windowMs: 120_000 },
    ],
    boostDomains: ['wasm', 'transform'],
    priority: 20,
  },
  {
    id: 'debug-memory',
    name: 'Debug + Memory inspection',
    conditions: [
      { type: 'domain_active', domain: 'debugger' },
      { type: 'event_count', event: 'debugger:breakpoint_hit', minCount: 1, windowMs: 120_000 },
    ],
    boostDomains: ['memory'],
    priority: 15,
  },
  {
    id: 'network-intercept-flow',
    name: 'Network interception workflow',
    conditions: [
      { type: 'domain_active', domain: 'network' },
      { type: 'domain_active', domain: 'browser' },
    ],
    boostDomains: ['hooks'],
    priority: 10,
  },
];

export class CompoundConditionEngine {
  private readonly conditions: CompoundCondition[];

  constructor(customConditions: CompoundCondition[] = []) {
    this.conditions = [...DEFAULT_COMPOUND_CONDITIONS, ...customConditions].toSorted(
      (a, b) => b.priority - a.priority,
    );
  }

  /**
   * Evaluate all compound conditions against the current state.
   * Returns a deduplicated list of domains that should be boosted.
   */
  evaluate(state: ConditionState): string[] {
    const domainsToBoost = new Set<string>();

    for (const condition of this.conditions) {
      if (this.allConditionsMet(condition, state)) {
        for (const domain of condition.boostDomains) {
          domainsToBoost.add(domain);
        }
      }
    }

    return [...domainsToBoost];
  }

  /**
   * Check if ALL conditions in a compound condition are met (AND logic).
   */
  private allConditionsMet(compound: CompoundCondition, state: ConditionState): boolean {
    return compound.conditions.every((predicate) => this.evaluatePredicate(predicate, state));
  }

  /**
   * Evaluate a single condition predicate.
   */
  private evaluatePredicate(predicate: ConditionPredicate, state: ConditionState): boolean {
    const now = Date.now();

    switch (predicate.type) {
      case 'platform':
        return state.platform === predicate.value;

      case 'domain_active':
        return state.activeDomains.has(predicate.domain);

      case 'event_count': {
        const windowStart = now - predicate.windowMs;
        const count = state.eventHistory.filter(
          (e) => e.event.startsWith(predicate.event) && e.timestamp >= windowStart,
        ).length;
        return count >= predicate.minCount;
      }

      case 'tool_called_recently': {
        // Check if the tool was called recently
        const windowStart = now - predicate.withinMs;
        return state.eventHistory.some(
          (e) =>
            e.event === 'tool:called' &&
            e.timestamp >= windowStart &&
            (e.payload as { toolName?: string })?.toolName === predicate.toolName,
        );
      }

      default:
        return false;
    }
  }

  /** Get the number of registered conditions. */
  get conditionCount(): number {
    return this.conditions.length;
  }
}
