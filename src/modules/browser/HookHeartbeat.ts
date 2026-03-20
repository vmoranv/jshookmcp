/**
 * HookHeartbeat — automatically re-injects InitScripts when SPA page navigations
 * destroy the execution context.
 *
 * Monitors `framenavigated` events and re-applies persistent scripts (Fetch/XHR
 * interceptors, DOM observers, etc.) that would otherwise be lost during
 * soft navigations in single-page applications.
 */
import { logger } from '@utils/logger';

export interface HeartbeatScript {
  /** Unique identifier for deduplication. */
  id: string;
  /** JavaScript source to evaluate in the page context. */
  source: string;
}

export interface HeartbeatOptions {
  /** Debounce interval (ms) to avoid re-injecting during rapid navigations. Default: 150 */
  debounceMs?: number;
  /** Only re-inject for main frame navigations. Default: true */
  mainFrameOnly?: boolean;
}

interface PageLike {
  on(event: 'framenavigated', handler: (frame: FrameLike) => void): void;
  off(event: 'framenavigated', handler: (frame: FrameLike) => void): void;
  evaluate(fn: string): Promise<unknown>;
  isClosed(): boolean;
  mainFrame(): FrameLike;
}

interface FrameLike {
  url(): string;
  parentFrame(): FrameLike | null;
}

export class HookHeartbeat {
  private readonly page: PageLike;
  private readonly scripts: Map<string, HeartbeatScript> = new Map();
  private readonly debounceMs: number;
  private readonly mainFrameOnly: boolean;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly boundHandler: (frame: FrameLike) => void;

  constructor(page: PageLike, options?: HeartbeatOptions) {
    this.page = page;
    this.debounceMs = options?.debounceMs ?? 150;
    this.mainFrameOnly = options?.mainFrameOnly ?? true;
    this.boundHandler = this.onFrameNavigated.bind(this);
  }

  /**
   * Register a persistent script to be re-injected on navigation.
   */
  addScript(script: HeartbeatScript): this {
    this.scripts.set(script.id, script);
    return this;
  }

  /**
   * Remove a registered script by id.
   */
  removeScript(id: string): this {
    this.scripts.delete(id);
    return this;
  }

  /**
   * Start monitoring frame navigations.
   */
  start(): this {
    if (this.running) return this;
    this.running = true;
    this.page.on('framenavigated', this.boundHandler);
    logger.debug(
      `[HookHeartbeat] Started monitoring (${this.scripts.size} scripts, debounce=${this.debounceMs}ms)`
    );
    return this;
  }

  /**
   * Stop monitoring and clean up.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.page.off('framenavigated', this.boundHandler);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    logger.debug('[HookHeartbeat] Stopped monitoring');
  }

  get isRunning(): boolean {
    return this.running;
  }

  get scriptCount(): number {
    return this.scripts.size;
  }

  private onFrameNavigated(frame: FrameLike): void {
    if (this.mainFrameOnly && frame.parentFrame() !== null) {
      return; // Skip sub-frame navigations
    }

    // Debounce rapid navigations (e.g. SPA hash changes)
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.reinjectAll(frame.url());
    }, this.debounceMs);
  }

  private async reinjectAll(url: string): Promise<void> {
    if (!this.running || this.page.isClosed()) return;
    if (this.scripts.size === 0) return;

    logger.debug(
      `[HookHeartbeat] Re-injecting ${this.scripts.size} scripts after navigation to ${url}`
    );

    for (const [id, script] of this.scripts) {
      try {
        await this.page.evaluate(script.source);
      } catch (error) {
        logger.warn(`[HookHeartbeat] Failed to re-inject script "${id}":`, error);
        // Don't stop — try remaining scripts
      }
    }
  }
}
