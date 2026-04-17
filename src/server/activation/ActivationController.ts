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
import { handleActivateDomain } from '@server/MCPServer.search.handlers.domain';
import type { ActivationControllerOptions, BoostRule, EventRecord } from './types';
import { CompoundConditionEngine, type ConditionState } from './CompoundConditionEngine';
import { PredictiveBooster } from './PredictiveBooster';
import { AutoPruner } from './AutoPruner';
import { getToolDomain, getProfileDomains } from '@server/ToolCatalog';
import { logger } from '@utils/logger';
import {
  ACTIVATION_BOOST_WINDOW_MS,
  ACTIVATION_COMPOUND_EVAL_EVERY,
  ACTIVATION_COOLDOWN_MS,
  ACTIVATION_EVENT_HISTORY_MAX,
  ACTIVATION_TTL_MINUTES,
} from '@src/constants';

/**
 * Default boost rules mapping events to domain activations.
 *
 * Each rule fires when its event pattern is detected on the EventBus and the
 * threshold is met within the sliding window.  The handler-level emit sites
 * are listed in the corresponding domain handlers.
 */
const DEFAULT_BOOST_RULES: BoostRule[] = [
  {
    eventPattern: 'debugger:breakpoint_hit',
    targetDomains: ['debugger'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'browser:navigated',
    targetDomains: ['browser'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'memory:scan_completed',
    targetDomains: ['memory'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'network:intercept_started',
    targetDomains: ['network', 'hooks'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 9,
  },
  {
    eventPattern: 'v8:heap_captured',
    targetDomains: ['v8-inspector'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'tls:keylog_started',
    targetDomains: ['boringssl-inspector'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'skia:scene_captured',
    targetDomains: ['skia-capture'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'frida:attached',
    targetDomains: ['binary-instrument'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'adb:device_connected',
    targetDomains: ['adb-bridge'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'mojo:message_captured',
    targetDomains: ['mojo-ipc'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'syscall:trace_started',
    targetDomains: ['syscall-hook'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
  {
    eventPattern: 'protocol:pattern_detected',
    targetDomains: ['protocol-analysis'],
    threshold: 1,
    windowMs: ACTIVATION_BOOST_WINDOW_MS,
    priority: 10,
  },
];

/**
 * Domains that are Windows-only (skip on macOS/Linux).
 * Derived from the project architecture: Win32-specific tools.
 */
const WIN32_ONLY_TOOL_PREFIXES = [
  'pe_', // PE analysis
  'anticheat_', // Anti-cheat detection
  'speedhack_', // Speedhack
  'hw_breakpoint_', // Hardware breakpoints
  'inject_', // Code injection
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
  private readonly maxEventHistory: number;

  /** Tool call counter for periodic compound evaluation. */
  private toolCallCount = 0;

  /** How often (in tool calls) compound conditions are evaluated. */
  private readonly compoundEvalEvery: number;

  /** Wave 2 sub-components. */
  private readonly compoundEngine: CompoundConditionEngine;
  private readonly predictiveBooster: PredictiveBooster;
  private readonly autoPruner: AutoPruner;

  private disposed = false;

  constructor(
    eventBus: EventBus<ServerEventMap>,
    ctx: MCPServerContext,
    options: ActivationControllerOptions = {},
  ) {
    this.eventBus = eventBus;
    this.ctx = ctx;
    this.cooldownMs = options.cooldownMs ?? ACTIVATION_COOLDOWN_MS;
    this.maxEventHistory = ACTIVATION_EVENT_HISTORY_MAX;
    this.compoundEvalEvery = Math.max(1, ACTIVATION_COMPOUND_EVAL_EVERY);

    // Merge default + custom boost rules, sort by priority descending
    const customRules = options.boostRules ?? [];
    this.boostRules = [...DEFAULT_BOOST_RULES, ...customRules].toSorted(
      (a, b) => b.priority - a.priority,
    );

    // Initialize Wave 2 sub-components
    this.compoundEngine = new CompoundConditionEngine();
    this.predictiveBooster = new PredictiveBooster();

    const baseDomains = new Set(getProfileDomains(ctx.baseTier));
    this.autoPruner = new AutoPruner(eventBus, baseDomains, (domain) => {
      logger.info(`[ActivationController] Auto-pruning domain "${domain}"`);
    });

    this.subscribe();

    logger.info(
      `[ActivationController] Initialized with ${this.boostRules.length} boost rules, ` +
        `cooldown=${this.cooldownMs}ms, platform=${process.platform}, ` +
        `${this.compoundEngine.conditionCount} compound conditions`,
    );
  }

  /** Subscribe to relevant EventBus events. */
  private subscribe(): void {
    // tool:called → track domain activity, update predictive booster, auto-pruner
    this.unsubscribers.push(
      this.eventBus.on('tool:called', (payload) => {
        this.recordEvent('tool:called', payload);
        if (payload.domain) {
          this.lastActivity.set(payload.domain, Date.now());
          this.autoPruner.recordActivity(payload.domain);
        }

        // Predictive boosting
        this.predictiveBooster.recordCall(payload.toolName);
        const predictedDomains = this.predictiveBooster.predictNextDomains(
          payload.toolName,
          (name) => getToolDomain(name) ?? null,
        );
        for (const domain of predictedDomains) {
          void this.attemptBoost(domain, `predictive: ${payload.toolName} → ${domain}`);
        }

        // Evaluate compound conditions every N tool calls (env-tunable)
        this.toolCallCount++;
        if (this.toolCallCount % this.compoundEvalEvery === 0) {
          this.evaluateCompoundConditions();
        }
      }),
    );

    // Subscribe every distinct boost-rule event so newly added auto-boost paths
    // cannot go stale when domain handlers start emitting more signals.
    const subscribedEvents = new Set<string>();
    for (const rule of this.boostRules) {
      if (!rule.eventPattern || subscribedEvents.has(rule.eventPattern)) {
        continue;
      }
      subscribedEvents.add(rule.eventPattern);
      const eventName = rule.eventPattern as keyof ServerEventMap;
      this.unsubscribers.push(
        this.eventBus.on(eventName, (payload) => {
          this.recordEvent(rule.eventPattern, payload);
          return this.evaluateBoostRules(rule.eventPattern);
        }),
      );
    }
  }

  /** Record an event in the sliding window. */
  private recordEvent(event: string, payload: unknown): void {
    this.eventHistory.push({ event, timestamp: Date.now(), payload });
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory.splice(0, this.eventHistory.length - this.maxEventHistory);
    }
  }

  /** Evaluate all boost rules for a given event. */
  private async evaluateBoostRules(eventName: string): Promise<void> {
    const now = Date.now();

    for (const rule of this.boostRules) {
      // Check if the event matches the rule's pattern
      if (!eventName.startsWith(rule.eventPattern)) continue;

      // Count matching events within the window
      const windowStart = now - rule.windowMs;
      const matchCount = this.eventHistory.filter(
        (e) => e.event.startsWith(rule.eventPattern) && e.timestamp >= windowStart,
      ).length;

      if (matchCount >= rule.threshold) {
        await Promise.all(
          rule.targetDomains.map((domain) =>
            this.attemptBoost(domain, `rule:${rule.eventPattern} (${matchCount} events)`),
          ),
        );
      }
    }
  }

  /**
   * Attempt to boost a domain, respecting the debounce cooldown.
   * Only boosts if the domain is not already in the enabled set.
   */
  private async attemptBoost(domain: string, reason: string): Promise<void> {
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

    await handleActivateDomain(this.ctx, {
      domain,
      ttlMinutes: ACTIVATION_TTL_MINUTES,
    });

    await this.eventBus.emit('activation:domain_boosted', {
      domain,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  /** Evaluate compound conditions and boost matching domains. */
  private evaluateCompoundConditions(): void {
    const state: ConditionState = {
      platform: process.platform,
      activeDomains: this.ctx.enabledDomains,
      eventHistory: this.eventHistory,
      recentToolCalls: this.eventHistory
        .filter((e) => e.event === 'tool:called')
        .map((e) => (e.payload as { toolName?: string })?.toolName ?? ''),
    };

    const domainsToBoost = this.compoundEngine.evaluate(state);
    for (const domain of domainsToBoost) {
      void this.attemptBoost(domain, `compound condition`);
    }
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

  /** Get the predictive booster (for testing). */
  getPredictiveBooster(): PredictiveBooster {
    return this.predictiveBooster;
  }

  /** Get the auto pruner (for testing). */
  getAutoPruner(): AutoPruner {
    return this.autoPruner;
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
    this.autoPruner.dispose();
    this.predictiveBooster.reset();
    logger.info('[ActivationController] Disposed');
  }
}
