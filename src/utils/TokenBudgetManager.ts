import { logger } from '@utils/logger';
import { RingBuffer } from '@utils/RingBuffer';
import { TOKEN_BUDGET_MAX_TOKENS } from '@src/constants';

export interface ToolCallRecord {
  toolName: string;
  timestamp: number;
  requestSize: number;
  responseSize: number;
  estimatedTokens: number;
  cumulativeTokens: number;
}

export interface TokenBudgetStats {
  currentUsage: number;
  maxTokens: number;
  usagePercentage: number;
  toolCallCount: number;
  topTools: Array<{ tool: string; tokens: number; percentage: number }>;
  warnings: number[];
  recentCalls: ToolCallRecord[];
  suggestions: string[];
}

/** Optional cleanup callback invoked during auto-cleanup (e.g., clearing DetailedDataManager). */
export type ExternalCleanupFn = () => void;

export class TokenBudgetManager {
  private static instance: TokenBudgetManager;

  private readonly MAX_TOKENS = TOKEN_BUDGET_MAX_TOKENS;
  private readonly WARNING_THRESHOLDS = [0.8, 0.9, 0.95];
  private readonly BYTES_PER_TOKEN = 4;
  private readonly AUTO_CLEANUP_THRESHOLD = 0.9;
  private readonly AUTO_CLEANUP_REARM_THRESHOLD = 0.8;
  /**
   * After a cleanup that freed nothing, wait for usage to grow by this fraction
   * of the budget before retrying. Prevents a no-op cleanup from disarming
   * auto-cleanup forever while still avoiding cleanup thrash.
   */
  private readonly AUTO_CLEANUP_RETRY_GROWTH = 0.05;
  private readonly HISTORY_RETENTION = 5 * 60 * 1000;
  /** Hard cap on retained tool-call records; bounds memory in long-lived sessions. */
  private readonly HISTORY_MAX_RECORDS = 2000;

  private currentUsage = 0;
  private toolCallHistory = new RingBuffer<ToolCallRecord>(this.HISTORY_MAX_RECORDS);
  /** Timestamp of the oldest buffered record (records are pushed in time order). */
  private headTimestamp: number | null = null;
  private warnings = new Set<number>();
  private sessionStartTime = Date.now();
  private trackingEnabled = true;
  private autoCleanupArmed = true;
  /** Usage level at which the last auto-cleanup attempt ran (retry hysteresis). */
  private autoCleanupWatermark = 0;

  /** Guards against re-entrant auto-cleanup through the external cleanup callback. */
  private cleanupRunning = false;
  /** Cooldown after an auto-cleanup before another one may trigger (prevents async callback loops). */
  private lastCleanupAt = 0;
  private static readonly AUTO_CLEANUP_COOLDOWN_MS = 1000;

  private readonly MAX_ESTIMATION_DEPTH = 4;
  private readonly MAX_ESTIMATION_ARRAY_ITEMS = 50;
  private readonly MAX_ESTIMATION_OBJECT_KEYS = 50;
  private readonly MAX_ESTIMATION_STRING_LENGTH = 2000;
  private readonly MAX_ESTIMATION_BYTES = 256 * 1024;

  private externalCleanupFn: ExternalCleanupFn | null = null;

  constructor() {
    logger.info('TokenBudgetManager initialized');
  }

  /** @deprecated Use constructor injection. Kept for backward compatibility. */
  static getInstance(): TokenBudgetManager {
    if (!this.instance) {
      this.instance = new TokenBudgetManager();
    }
    return this.instance;
  }

  /**
   * Register a callback invoked during auto-cleanup to clear external caches.
   * This replaces the previous hard dependency on DetailedDataManager.getInstance().
   */
  setExternalCleanup(fn: ExternalCleanupFn): void {
    this.externalCleanupFn = fn;
  }

  recordToolCall(toolName: string, request: unknown, response: unknown): void {
    if (!this.trackingEnabled) {
      return;
    }

    try {
      const requestSize = this.calculateSize(request);
      const responseSize = this.calculateSize(response);
      const totalSize = requestSize + responseSize;
      const estimatedTokens = this.estimateTokens(totalSize);

      this.currentUsage += estimatedTokens;

      const record: ToolCallRecord = {
        toolName,
        timestamp: Date.now(),
        requestSize,
        responseSize,
        estimatedTokens,
        cumulativeTokens: this.currentUsage,
      };
      // Bound the history: drop over-age records, then make room at the hard
      // cap (RingBuffer would otherwise silently overwrite the oldest record
      // and drift the running token total).
      this.pruneStaleHistory();
      this.evictForCap();
      this.toolCallHistory.push(record);
      if (this.headTimestamp === null) {
        this.headTimestamp = record.timestamp;
      }

      logger.debug(
        `Token usage: ${this.currentUsage}/${this.MAX_TOKENS} (${this.getUsagePercentage()}%) | ` +
          `Tool: ${toolName} | Size: ${(totalSize / 1024).toFixed(1)}KB | Tokens: ${estimatedTokens}`,
      );

      this.checkWarnings();

      if (this.isAutoCleanupDue()) {
        this.autoCleanup();
      }
    } catch (error) {
      logger.error('Failed to record tool call:', error);
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
  }

  private hasDetailedSummarySize(
    value: unknown,
  ): value is { detailId: unknown; summary: { size: number } } {
    if (!this.isRecord(value) || !('detailId' in value)) {
      return false;
    }

    const summary = value.summary;
    if (!this.isRecord(summary)) {
      return false;
    }

    const { size } = summary;
    return typeof size === 'number' && Number.isFinite(size) && size > 0;
  }

  /**
   * Fast path for common MCP tool response envelopes:
   *   { content: [{ type: 'text', text: string }], isError?: boolean }
   *
   * Avoids full recursive normalization by estimating size directly from
   * the text payload with the same truncation semantics.
   */
  private tryEstimateMcpEnvelope(data: unknown): number | null {
    if (!this.isRecord(data)) return null;
    const content = data['content'];
    if (!Array.isArray(content) || content.length === 0) return null;

    const first = content[0] as unknown;
    if (!this.isRecord(first)) return null;
    if (first['type'] !== 'text' || typeof first['text'] !== 'string') return null;

    const text = first['text'] as string;
    // Apply same string truncation as normalizeForSizeEstimate
    const truncated =
      text.length > this.MAX_ESTIMATION_STRING_LENGTH
        ? `${text.slice(0, this.MAX_ESTIMATION_STRING_LENGTH)}...[truncated:${text.length}]`
        : text;

    // Build minimal envelope skeleton for size estimation
    // ~40 bytes overhead for {"content":[{"type":"text","text":""}]}
    const overhead = 42 + (data['isError'] === true ? 14 : 0);
    const textBytes = Buffer.byteLength(truncated, 'utf8');
    return Math.min(overhead + textBytes, this.MAX_ESTIMATION_BYTES);
  }

  private calculateSize(data: unknown): number {
    try {
      // Fast path 0: Plain string input
      if (typeof data === 'string') {
        const truncatedLen = Math.min(data.length, this.MAX_ESTIMATION_STRING_LENGTH);
        return Math.min(
          Buffer.byteLength(data.slice(0, truncatedLen), 'utf8'),
          this.MAX_ESTIMATION_BYTES,
        );
      }

      // Fast path 1: DetailedDataResponse with pre-computed size
      if (this.hasDetailedSummarySize(data)) {
        return Math.min(data.summary.size, this.MAX_ESTIMATION_BYTES);
      }

      // Fast path 2: Direct pre-measured contentLength attribute
      if (
        this.isRecord(data) &&
        typeof data['contentLength'] === 'number' &&
        Number.isFinite(data['contentLength'])
      ) {
        return Math.min(data['contentLength'] as number, this.MAX_ESTIMATION_BYTES);
      }

      // Fast path 3: Common MCP envelope — skip recursive normalization
      const mcpSize = this.tryEstimateMcpEnvelope(data);
      if (mcpSize !== null) return mcpSize;

      // Full path: recursive normalization + serialization
      const normalized = this.normalizeForSizeEstimate(data, 0, new WeakSet<object>());
      const serialized = JSON.stringify(normalized);
      if (!serialized) {
        return 0;
      }
      return Math.min(Buffer.byteLength(serialized, 'utf8'), this.MAX_ESTIMATION_BYTES);
    } catch (error) {
      logger.warn('Failed to calculate data size:', error);
      return 0;
    }
  }

  private normalizeForSizeEstimate(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    const valueType = typeof value;
    if (valueType === 'boolean' || valueType === 'number') {
      return value;
    }

    if (valueType === 'string') {
      const stringValue = value as string;
      if (stringValue.length <= this.MAX_ESTIMATION_STRING_LENGTH) {
        return stringValue;
      }

      const marker = `...[truncated:${stringValue.length}]`;
      const maxPrefixLength = Math.max(this.MAX_ESTIMATION_STRING_LENGTH - marker.length, 0);
      return `${stringValue.slice(0, maxPrefixLength)}${marker}`;
    }

    if (valueType === 'bigint') {
      return value.toString();
    }

    if (valueType === 'symbol') {
      return value.toString();
    }

    if (valueType === 'function') {
      return '[Function]';
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack?.slice(0, this.MAX_ESTIMATION_STRING_LENGTH),
      };
    }

    if (Buffer.isBuffer(value)) {
      return `[Buffer:${value.byteLength}]`;
    }

    if (depth >= this.MAX_ESTIMATION_DEPTH) {
      if (Array.isArray(value)) {
        return `[Array:${value.length}]`;
      }
      return '[Object]';
    }

    if (Array.isArray(value)) {
      const limited = value
        .slice(0, this.MAX_ESTIMATION_ARRAY_ITEMS)
        .map((item) => this.normalizeForSizeEstimate(item, depth + 1, seen));
      if (value.length > this.MAX_ESTIMATION_ARRAY_ITEMS) {
        limited.push(`[truncated:${value.length - this.MAX_ESTIMATION_ARRAY_ITEMS}]`);
      }
      return limited;
    }

    if (valueType === 'object') {
      /* v8 ignore next 3 */
      if (!this.isRecord(value)) {
        return '[Object]';
      }

      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);

      const entries = Object.entries(value);
      const limitedEntries = entries.slice(0, this.MAX_ESTIMATION_OBJECT_KEYS);
      const out: Record<string, unknown> = {};
      for (const [key, nestedValue] of limitedEntries) {
        out[key] = this.normalizeForSizeEstimate(nestedValue, depth + 1, seen);
      }
      if (entries.length > this.MAX_ESTIMATION_OBJECT_KEYS) {
        out.__truncatedKeys = entries.length - this.MAX_ESTIMATION_OBJECT_KEYS;
      }
      return out;
    }

    /* v8 ignore next */
    return String(value);
  }

  private estimateTokens(bytes: number): number {
    return Math.ceil(bytes / this.BYTES_PER_TOKEN);
  }

  getUsagePercentage(): number {
    return Math.round((this.currentUsage / this.MAX_TOKENS) * 100);
  }

  private checkWarnings(): void {
    const ratio = this.currentUsage / this.MAX_TOKENS;

    for (const threshold of this.WARNING_THRESHOLDS) {
      if (ratio >= threshold && !this.warnings.has(threshold)) {
        this.emitWarning(threshold);
        this.warnings.add(threshold);
      }
    }
  }

  private emitWarning(threshold: number): void {
    const percentage = Math.round(threshold * 100);
    const remaining = this.MAX_TOKENS - this.currentUsage;

    logger.warn(
      `Token Budget Warning: ${percentage}% used! ` +
        `(${this.currentUsage}/${this.MAX_TOKENS}, ${remaining} tokens remaining)`,
    );

    if (threshold >= 0.95) {
      logger.warn('CRITICAL: Consider clearing caches or starting a new session.');
    } else if (threshold >= 0.9) {
      logger.warn('HIGH: Auto-cleanup will trigger soon. Consider using summary modes.');
    } else if (threshold >= 0.8) {
      logger.warn('MODERATE: Monitor usage. Use get_token_budget_stats for details.');
    }
  }

  private shouldAutoCleanup(): boolean {
    const ratio = this.currentUsage / this.MAX_TOKENS;
    if (ratio < this.AUTO_CLEANUP_REARM_THRESHOLD) {
      this.autoCleanupArmed = true;
      this.autoCleanupWatermark = 0;
    } else if (!this.autoCleanupArmed) {
      // A cleanup that freed nothing (all records still inside the retention
      // window, or an external callback that cleared nothing) must not disarm
      // cleanup until usage drops below 80%: re-arm once usage has grown
      // measurably past the level the last attempt ran at.
      const growthSinceAttempt = this.currentUsage - this.autoCleanupWatermark;
      if (growthSinceAttempt >= this.MAX_TOKENS * this.AUTO_CLEANUP_RETRY_GROWTH) {
        this.autoCleanupArmed = true;
      }
    }
    return this.autoCleanupArmed && ratio >= this.AUTO_CLEANUP_THRESHOLD;
  }

  /**
   * Whether an automatic cleanup may fire right now. Enforces both the armed
   * state and a cooldown after the last cleanup, so an async external cleanup
   * callback that records more tool calls cannot chain-trigger cleanups.
   */
  private isAutoCleanupDue(): boolean {
    if (Date.now() - this.lastCleanupAt < TokenBudgetManager.AUTO_CLEANUP_COOLDOWN_MS) {
      return false;
    }
    return this.shouldAutoCleanup();
  }

  private autoCleanup(): void {
    // Re-entrance guard: the external cleanup callback may synchronously call
    // manualCleanup() or recordToolCall(), which would otherwise recurse into
    // autoCleanup() until the stack overflows.
    if (this.cleanupRunning) {
      return;
    }
    this.cleanupRunning = true;
    try {
      this.autoCleanupArmed = false;
      logger.info('Auto-cleanup triggered at 90% usage.');

      const beforeUsage = this.currentUsage;

      if (this.externalCleanupFn) {
        try {
          this.externalCleanupFn();
          logger.info('External cleanup callback invoked');
        } catch (e) {
          logger.warn('External cleanup callback failed:', e);
        }
      }

      const cutoff = Date.now() - this.HISTORY_RETENTION;
      const beforeCount = this.toolCallHistory.length;
      const retained = this.toolCallHistory.toArray().filter((call) => call.timestamp > cutoff);
      const next = new RingBuffer<ToolCallRecord>(this.HISTORY_MAX_RECORDS);
      for (const call of retained) {
        next.push(call);
      }
      this.toolCallHistory = next;
      this.headTimestamp = retained[0]?.timestamp ?? null;
      const removedCount = beforeCount - this.toolCallHistory.length;
      logger.info(`Removed ${removedCount} old tool call records`);

      this.recalculateUsage();

      const afterUsage = this.currentUsage;
      const freed = beforeUsage - afterUsage;
      const freedPercentage = Math.round((freed / this.MAX_TOKENS) * 100);

      logger.info(
        `Cleanup complete. Freed ${freed} tokens (${freedPercentage}%). ` +
          `Usage: ${afterUsage}/${this.MAX_TOKENS} (${this.getUsagePercentage()}%)`,
      );

      const newRatio = afterUsage / this.MAX_TOKENS;
      this.autoCleanupWatermark = afterUsage;
      // Re-arm only when the attempt made progress (or usage is comfortably
      // below the trigger). A zero-freed attempt stays disarmed until
      // shouldAutoCleanup() sees enough new growth, so the budget cannot
      // silently blow past 100% after one futile cleanup.
      if (freed > 0 || newRatio < this.AUTO_CLEANUP_REARM_THRESHOLD) {
        this.autoCleanupArmed = true;
      }
      this.warnings = new Set(
        Array.from(this.warnings).filter((threshold) => newRatio >= threshold),
      );
    } finally {
      this.cleanupRunning = false;
      this.lastCleanupAt = Date.now();
    }
  }

  /**
   * Drop records that fell out of the retention window. Records are pushed
   * in time order, so stale entries form a contiguous prefix. The O(1)
   * fast path (fresh head) keeps the per-push cost constant.
   */
  private pruneStaleHistory(): void {
    if (this.headTimestamp === null) {
      return;
    }
    const cutoff = Date.now() - this.HISTORY_RETENTION;
    if (this.headTimestamp > cutoff) {
      return;
    }

    const snapshot = this.toolCallHistory.toArray();
    let staleCount = 0;
    while (staleCount < snapshot.length) {
      const candidate = snapshot[staleCount];
      if (!candidate || candidate.timestamp > cutoff) {
        break;
      }
      staleCount++;
    }

    let prunedTokens = 0;
    for (let i = 0; i < staleCount; i++) {
      const evicted = this.toolCallHistory.shift();
      if (evicted) {
        prunedTokens += evicted.estimatedTokens;
      }
    }
    this.currentUsage -= prunedTokens;
    this.headTimestamp = snapshot[staleCount]?.timestamp ?? null;
  }

  /**
   * Drop the oldest record when the buffer sits at the hard cap, so evicted
   * tokens leave the running total instead of being silently overwritten.
   */
  private evictForCap(): void {
    if (this.toolCallHistory.length < this.HISTORY_MAX_RECORDS) {
      return;
    }
    const evicted = this.toolCallHistory.shift();
    if (evicted) {
      this.currentUsage -= evicted.estimatedTokens;
    }
    this.headTimestamp = this.toolCallHistory.peek()?.timestamp ?? null;
  }

  private recalculateUsage(): void {
    let sum = 0;
    for (const call of this.toolCallHistory) {
      sum += call.estimatedTokens;
    }
    this.currentUsage = sum;
  }

  getStats(): TokenBudgetStats & { sessionStartTime: number } {
    const toolUsage = new Map<string, number>();
    for (const call of this.toolCallHistory) {
      const current = toolUsage.get(call.toolName) || 0;
      toolUsage.set(call.toolName, current + call.estimatedTokens);
    }

    const topTools = Array.from(toolUsage.entries())
      .map(([tool, tokens]) => ({
        tool,
        tokens,
        percentage: Math.round((tokens / this.currentUsage) * 100),
      }))
      .toSorted((a, b) => b.tokens - a.tokens)
      .slice(0, 10);

    const suggestions = this.generateSuggestions(topTools);

    const recentCalls = this.toolCallHistory.toArray().slice(-20);

    return {
      currentUsage: this.currentUsage,
      maxTokens: this.MAX_TOKENS,
      usagePercentage: this.getUsagePercentage(),
      toolCallCount: this.toolCallHistory.length,
      topTools,
      warnings: Array.from(this.warnings).map((t) => Math.round(t * 100)),
      recentCalls,
      suggestions,
      sessionStartTime: this.sessionStartTime,
    };
  }

  private generateSuggestions(
    topTools: Array<{ tool: string; tokens: number; percentage: number }>,
  ): string[] {
    const suggestions: string[] = [];
    const ratio = this.currentUsage / this.MAX_TOKENS;

    if (ratio >= 0.95) {
      suggestions.push(' CRITICAL: Clear all caches immediately or start a new session');
    } else if (ratio >= 0.9) {
      suggestions.push('HIGH: Auto-cleanup triggered. Consider manual cleanup for better control');
    } else if (ratio >= 0.8) {
      suggestions.push('MODERATE: Monitor usage closely. Use summary modes for large data');
    }

    for (const { tool, percentage } of topTools) {
      if (percentage > 30) {
        if (tool.includes('collect_code')) {
          suggestions.push(
            ` ${tool} uses ${percentage}% tokens. Try smartMode="summary" or "priority"`,
          );
        } else if (tool.includes('get_script_source')) {
          suggestions.push(` ${tool} uses ${percentage}% tokens. Try preview=true first`);
        } else if (tool.includes('network_get_requests')) {
          suggestions.push(` ${tool} uses ${percentage}% tokens. Reduce limit or use filters`);
        } else if (tool.includes('page_evaluate')) {
          suggestions.push(
            ` ${tool} uses ${percentage}% tokens. Query specific properties instead of full objects`,
          );
        }
      }
    }

    if (suggestions.length === 0) {
      suggestions.push(' Token usage is healthy. Continue monitoring.');
    }

    return suggestions;
  }

  manualCleanup(): void {
    logger.info('Manual cleanup requested.');
    this.autoCleanup();
  }

  setTrackingEnabled(enabled: boolean): void {
    if (this.trackingEnabled === enabled) {
      return;
    }

    this.trackingEnabled = enabled;
    logger.warn(`Token budget tracking ${enabled ? 'enabled' : 'disabled'}`);
  }

  isTrackingEnabled(): boolean {
    return this.trackingEnabled;
  }

  reset(): void {
    logger.info('Resetting token budget...');
    this.currentUsage = 0;
    this.toolCallHistory = new RingBuffer<ToolCallRecord>(this.HISTORY_MAX_RECORDS);
    this.headTimestamp = null;
    this.warnings.clear();
    this.autoCleanupArmed = true;
    this.autoCleanupWatermark = 0;
    this.sessionStartTime = Date.now();
    logger.info('Token budget reset complete');
  }
}
