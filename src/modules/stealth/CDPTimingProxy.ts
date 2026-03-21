/**
 * CDP Timing Proxy — transparent jitter injection on CDP send() calls.
 *
 * Wraps any CDP session and adds random delay to all send() calls
 * to mimic natural network latency and prevent timing-based bot detection.
 */

import type { CDPTimingOptions } from './CDPTimingProxy.types';
import { DEFAULT_TIMING_OPTIONS } from './CDPTimingProxy.types';

/**
 * Minimal CDP session interface — compatible with both puppeteer and playwright sessions.
 */
export interface CDPSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: unknown) => void): void;
  off(event: string, handler: (params: unknown) => void): void;
}

export class CDPTimingProxy implements CDPSessionLike {
  private options: CDPTimingOptions;

  constructor(
    private readonly wrapped: CDPSessionLike,
    options?: Partial<CDPTimingOptions>
  ) {
    this.options = { ...DEFAULT_TIMING_OPTIONS, ...options };
  }

  /**
   * Send a CDP command with optional timing jitter.
   * When jitter is enabled and burst mode is off, a random delay
   * is injected before forwarding to the wrapped session.
   */
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.options.enabled && !this.options.burstMode) {
      const delay =
        this.options.minDelayMs +
        Math.random() * (this.options.maxDelayMs - this.options.minDelayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    return this.wrapped.send(method, params);
  }

  /** Pass-through event listener registration. */
  on(event: string, handler: (params: unknown) => void): void {
    this.wrapped.on(event, handler);
  }

  /** Pass-through event listener removal. */
  off(event: string, handler: (params: unknown) => void): void {
    this.wrapped.off(event, handler);
  }

  /** Update jitter configuration at runtime. */
  configure(options: Partial<CDPTimingOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /** Enable burst mode — skip all jitter for time-critical operations. */
  enterBurstMode(): void {
    this.options.burstMode = true;
  }

  /** Disable burst mode — restore jitter injection. */
  exitBurstMode(): void {
    this.options.burstMode = false;
  }

  /** Get current timing configuration. */
  getOptions(): Readonly<CDPTimingOptions> {
    return { ...this.options };
  }

  /** Get the underlying wrapped CDP session. */
  getWrappedSession(): CDPSessionLike {
    return this.wrapped;
  }
}

/**
 * Factory function — wrap a CDP session with timing jitter.
 */
export function wrapWithJitter(
  session: CDPSessionLike,
  options?: Partial<CDPTimingOptions>
): CDPTimingProxy {
  return new CDPTimingProxy(session, options);
}
