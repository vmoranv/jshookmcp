/**
 * CDPTimingProxy configuration types.
 */

export interface CDPTimingOptions {
  /** Whether timing jitter is enabled. Default: true */
  enabled: boolean;
  /** Minimum delay in milliseconds. Default: 20 */
  minDelayMs: number;
  /** Maximum delay in milliseconds. Default: 80 */
  maxDelayMs: number;
  /** When true, jitter is skipped for time-critical operations. Default: false */
  burstMode: boolean;
}

export const DEFAULT_TIMING_OPTIONS: CDPTimingOptions = {
  enabled: true,
  minDelayMs: 20,
  maxDelayMs: 80,
  burstMode: false,
};
