/** Pure admission/retry policy for the browser session queue. */

export interface BrowserSessionAdmissionOptions {
  maxPending: number;
  expectedConcurrency: number;
  reservedPendingPerSession: number;
}

/**
 * Reserve capacity for sessions that have not queued yet.
 *
 * As each late session arrives its reservation becomes immediately admissible.
 */
export function computeAdmissionLimit(
  options: BrowserSessionAdmissionOptions,
  demandSessionCount: number,
): number {
  const reserved = options.reservedPendingPerSession;
  if (reserved === 0) return options.maxPending;

  const reservableConcurrency = Math.min(
    options.expectedConcurrency,
    Math.floor(options.maxPending / reserved),
  );
  const protectedSessions = Math.max(0, reservableConcurrency - demandSessionCount);
  return Math.max(1, options.maxPending - protectedSessions * reserved);
}

/** Suggested retry delay for a queued request, bounded by the wait timeout. */
export function computeRetryAfterMs(
  averageServiceMs: number,
  competingSessions: number,
  waitTimeoutMs: number,
): number {
  const raw = averageServiceMs * Math.max(1, competingSessions);
  return Math.ceil(Math.min(waitTimeoutMs, Math.max(1, raw)));
}
