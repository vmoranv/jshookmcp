/**
 * AutoPruner — removes irrelevant tools from context when leaving a domain state.
 *
 * Tracks per-domain activity timestamps and periodically checks for domains
 * that have been inactive beyond their configured threshold. Base tier domains
 * are never pruned.
 *
 * Requirement addressed: BOOST-07
 */
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { logger } from '@utils/logger';
import {
  AUTOPRUNE_AUTO_INACTIVITY_MS,
  AUTOPRUNE_CHECK_INTERVAL_MS,
  AUTOPRUNE_MANUAL_INACTIVITY_MS,
} from '@src/constants';

/** Configuration for auto-prune behavior. */
export interface AutoPruneConfig {
  /** Inactivity threshold for auto-activated domains (ms). */
  autoActivatedInactivityMs?: number;
  /** Inactivity threshold for manually activated domains (ms). */
  manualActivatedInactivityMs?: number;
  /** How often to run the prune check (ms). */
  checkIntervalMs?: number;
}

export class AutoPruner {
  /** Per-domain last activity timestamp. */
  private readonly lastActivity = new Map<string, number>();

  /** Domains that are in the base tier (never prunable). */
  private readonly baseDomains: Set<string>;

  /** Domains that were auto-activated (shorter TTL). */
  private readonly autoActivatedDomains = new Set<string>();

  private readonly autoInactivityMs: number;
  private readonly manualInactivityMs: number;
  private readonly checkIntervalMs: number;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private readonly eventBus: EventBus<ServerEventMap>;

  /** Callback invoked when a domain should be pruned. */
  private readonly onPrune: (domain: string) => void;

  constructor(
    eventBus: EventBus<ServerEventMap>,
    baseDomains: Set<string>,
    onPrune: (domain: string) => void,
    config: AutoPruneConfig = {},
  ) {
    this.eventBus = eventBus;
    this.baseDomains = baseDomains;
    this.onPrune = onPrune;
    this.autoInactivityMs = config.autoActivatedInactivityMs ?? AUTOPRUNE_AUTO_INACTIVITY_MS;
    this.manualInactivityMs = config.manualActivatedInactivityMs ?? AUTOPRUNE_MANUAL_INACTIVITY_MS;
    this.checkIntervalMs = config.checkIntervalMs ?? AUTOPRUNE_CHECK_INTERVAL_MS;

    this.startCheckTimer();
  }

  /** Record activity for a domain. */
  recordActivity(domain: string): void {
    this.lastActivity.set(domain, Date.now());
  }

  /** Mark a domain as auto-activated (shorter inactivity threshold). */
  markAutoActivated(domain: string): void {
    this.autoActivatedDomains.add(domain);
    this.lastActivity.set(domain, Date.now());
  }

  /** Start the periodic prune check. */
  private startCheckTimer(): void {
    this.checkTimer = setInterval(() => {
      this.checkAndPrune();
    }, this.checkIntervalMs);

    // Ensure timer doesn't prevent process exit
    if (this.checkTimer.unref) {
      this.checkTimer.unref();
    }
  }

  /** Check all tracked domains and prune inactive ones. */
  private checkAndPrune(): void {
    const now = Date.now();

    for (const [domain, lastTime] of this.lastActivity.entries()) {
      // Never prune base tier domains
      if (this.baseDomains.has(domain)) continue;

      const inactivityMs = now - lastTime;
      const threshold = this.autoActivatedDomains.has(domain)
        ? this.autoInactivityMs
        : this.manualInactivityMs;

      if (inactivityMs >= threshold) {
        logger.info(
          `[AutoPruner] Pruning domain "${domain}" — inactive for ${Math.round(inactivityMs / 1000)}s ` +
            `(threshold: ${Math.round(threshold / 1000)}s)`,
        );

        this.onPrune(domain);
        this.lastActivity.delete(domain);
        this.autoActivatedDomains.delete(domain);

        // Emit pruned event
        void this.eventBus.emit('activation:domain_pruned', {
          domain,
          reason: `inactivity (${Math.round(inactivityMs / 1000)}s)`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /** Get last activity time for a domain (for testing). */
  getLastActivity(domain: string): number | undefined {
    return this.lastActivity.get(domain);
  }

  /** Check if a domain is tracked as auto-activated (for testing). */
  isAutoActivated(domain: string): boolean {
    return this.autoActivatedDomains.has(domain);
  }

  /** Clean up the timer. */
  dispose(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.lastActivity.clear();
    this.autoActivatedDomains.clear();
  }
}
