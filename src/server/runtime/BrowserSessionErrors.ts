/** Queue/admission errors raised by the browser session coordinator. */
export class BrowserSessionQueueError extends Error {
  public readonly code:
    | 'BROWSER_SESSION_QUEUE_FULL'
    | 'BROWSER_SESSION_QUEUE_TIMEOUT'
    | 'BROWSER_SESSION_QUEUE_CANCELLED'
    | 'BROWSER_SESSION_CLOSED'
    | 'BROWSER_SESSION_LIMIT_REACHED'
    | 'BROWSER_SESSION_CROSS_SESSION_REENTRY';
  public readonly retryAfterMs: number | null;
  public readonly queueDepth: number | null;
  public readonly queueLimit: number | null;
  constructor(
    message: string,
    code:
      | 'BROWSER_SESSION_QUEUE_FULL'
      | 'BROWSER_SESSION_QUEUE_TIMEOUT'
      | 'BROWSER_SESSION_QUEUE_CANCELLED'
      | 'BROWSER_SESSION_CLOSED'
      | 'BROWSER_SESSION_LIMIT_REACHED'
      | 'BROWSER_SESSION_CROSS_SESSION_REENTRY',
    retryAfterMs: number | null = null,
    queueDepth: number | null = null,
    queueLimit: number | null = null,
  ) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.queueDepth = queueDepth;
    this.queueLimit = queueLimit;
    this.name = 'BrowserSessionQueueError';
  }
}
