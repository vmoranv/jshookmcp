/**
 * ActivationController — event-driven auto-boost & auto-prune for tool domains.
 *
 * Subscribes to EventBus events and automatically:
 * - Boosts relevant domains when event patterns are detected (e.g., breakpoint → debugger)
 * - Filters tools based on runtime platform (macOS vs Windows)
 * - Enforces debounced cool-down (default 30s) to prevent feedback loops
 * - Tracks domain activity for auto-pruning (delegated to AutoPruner)
 *
 * Requirements addressed: BOOST-01, BOOST-02, BOOST-03, BOOST-04
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ActivationControllerOptions, BoostRule, EventRecord } from './types';
import { logger } from '@utils/logger';

/** Default boost rules mapping events to domain activations. */
const DEFAULT_BOOST_RULES: BoostRule[] = [
  {
    eventPattern: 'debugger:breakpoint_hit',
    targetDomains: ['debugger'],
    threshold: 1,
    windowMs: 60_000,
    priority: 10,
  },
  {
    eventPattern: 'browser:navigated',
    targetDomains: ['browser'],
    threshold: 1,
    windowMs: 60_000,
    priority: 10,
  },
  {
    eventPattern: 'memory:scan_completed',
    targetDomains: ['memory'],
    threshold: 1,
    windowMs: 60_000,
    priority: 10,
  },
];

/**
 * Domains that are Windows-only (skip on macOS/Linux).
 * Derived from the project architecture: Win32-specific tools.
 */
const WIN32_ONLY_TOOL_PREFIXES = [
  'pe_',            // PE analysis
  'anticheat_',     // Anti-cheat detection
  'speedhack_',     // Speedhack
  'hw_breakpoint_', // Hardware breakpoints
  'inject_',        // Code injection
];

/**
 * Filter tools based on the current platform.
 * Removes Windows-only tools when running on macOS/Linux.
 */
export function getPlatformFilteredTools(tools: Tool[]): Tool[] {
  const platform = process.platform;

  if (platform === 'win32') {
    // On Windows, all tools are available
    return tools;
  }

  // On non-Windows platforms, filter out Win32-only tools
  return tools.filter((tool) => {
    return !WIN32_ONLY_TOOL_PREFIXES.some((prefix) => tool.name.startsWith(prefix));
  });
}

export class ActivationController {
  private readonly eventBus: EventBus<ServerEventMap>;
  private readonly ctx: MCPServerContext;
  private readonly cooldownMs: number;
  private readonly boostRules: BoostRule[];
  private readonly unsubscribers: Array<() => void> = [];

  /** Per-domain last-boost timestamp for debounce. */
  private readonly lastBoostTime = new Map<string, number>();

  /** Per-domain last activity timestamp. */
  private readonly lastActivity = new Map<string, number>();

  /** Sliding window of recent events for pattern matching. */
  private readonly eventHistory: EventRecord[] = [];

  /** Max events to keep in sliding window. */
  private readonly maxEventHistory = 200;

  private disposed = false;

  constructor(
    eventBus: EventBus<ServerEventMap>,
    ctx: MCPServerContext,
    options: ActivationControllerOptions = {}
  ) {
    this.eventBus = eventBus;
    this.ctx = ctx;
    this.cooldownMs = options.cooldownMs ?? 30_000;

    // Merge default + custom boost rules, sort by priority descending
    const customRules = options.boostRules ?? [];
    this.boostRules = [...DEFAULT_BOOST_RULES, ...customRules].sort(
      (a, b) => b.priority - a.priority
    );

    this.subscribe();

    logger.info(
      `[ActivationController] Initialized with ${this.boostRules.length} boost rules, ` +
        `cooldown=${this.cooldownMs}ms, platform=${process.platform}`
    );
  }

  /** Subscribe to relevant EventBus events. */
  private subscribe(): void {
    // tool:called → track domain activity
    this.unsubscribers.push(
      this.eventBus.on('tool:called', (payload) => {
        this.recordEvent('tool:called', payload);
        if (payload.domain) {
          this.lastActivity.set(payload.domain, Date.now());
        }
      })
    );

    // debugger:breakpoint_hit → boost debugger domain
    this.unsubscribers.push(
      this.eventBus.on('debugger:breakpoint_hit', (payload) => {
        this.recordEvent('debugger:breakpoint_hit', payload);
        this.evaluateBoostRules('debugger:breakpoint_hit');
      })
    );

    // browser:navigated → boost browser domain
    this.unsubscribers.push(
      this.eventBus.on('browser:navigated', (payload) => {
        this.recordEvent('browser:navigated', payload);
        this.evaluateBoostRules('browser:navigated');
      })
    );

    // memory:scan_completed → boost memory domain
    this.unsubscribers.push(
      this.eventBus.on('memory:scan_completed', (payload) => {
        this.recordEvent('memory:scan_completed', payload);
        this.evaluateBoostRules('memory:scan_completed');
      })
    );
  }

  /** Record an event in the sliding window. */
  private recordEvent(event: string, payload: unknown): void {
    this.eventHistory.push({ event, timestamp: Date.now(), payload });
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory.splice(0, this.eventHistory.length - this.maxEventHistory);
    }
  }

  /** Evaluate all boost rules for a given event. */
  private evaluateBoostRules(eventName: string): void {
    const now = Date.now();

    for (const rule of this.boostRules) {
      // Check if the event matches the rule's pattern
      if (!eventName.startsWith(rule.eventPattern)) continue;

      // Count matching events within the window
      const windowStart = now - rule.windowMs;
      const matchCount = this.eventHistory.filter(
        (e) => e.event.startsWith(rule.eventPattern) && e.timestamp >= windowStart
      ).length;

      if (matchCount >= rule.threshold) {
        for (const domain of rule.targetDomains) {
          this.attemptBoost(domain, `rule:${rule.eventPattern} (${matchCount} events)`);
        }
      }
    }
  }

  /**
   * Attempt to boost a domain, respecting the debounce cooldown.
   * Only boosts if the domain is not already in the enabled set.
   */
  private attemptBoost(domain: string, reason: string): void {
    if (this.disposed) return;

    const now = Date.now();
    const lastBoost = this.lastBoostTime.get(domain) ?? 0;

    // Debounce check
    if (now - lastBoost < this.cooldownMs) {
      return;
    }

    // Skip if domain is already enabled/active
    if (this.ctx.enabledDomains.has(domain)) {
      return;
    }

    this.lastBoostTime.set(domain, now);

    logger.info(`[ActivationController] Boosting domain "${domain}" — reason: ${reason}`);

    // Emit the boosted event (fire-and-forget)
    void this.eventBus.emit('activation:domain_boosted', {
      domain,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  /** Get the last activity timestamp for a domain. */
  getLastActivity(domain: string): number | undefined {
    return this.lastActivity.get(domain);
  }

  /** Get all event history for testing/debugging. */
  getEventHistory(): readonly EventRecord[] {
    return this.eventHistory;
  }

  /** Get the last boost time for a domain (for testing). */
  getLastBoostTime(domain: string): number | undefined {
    return this.lastBoostTime.get(domain);
  }

  /** Clean up all subscriptions and timers. */
  dispose(): void {
    this.disposed = true;
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    this.lastBoostTime.clear();
    this.lastActivity.clear();
    this.eventHistory.length = 0;
    logger.info('[ActivationController] Disposed');
  }
}
