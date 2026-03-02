import { logger } from './logger.js';

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

  private readonly MAX_TOKENS = 200000;
  private readonly WARNING_THRESHOLDS = [0.8, 0.9, 0.95];
  private readonly BYTES_PER_TOKEN = 4;
  private readonly AUTO_CLEANUP_THRESHOLD = 0.9;
  private readonly HISTORY_RETENTION = 5 * 60 * 1000;

  private currentUsage = 0;
  private toolCallHistory: ToolCallRecord[] = [];
  private warnings = new Set<number>();
  private sessionStartTime = Date.now();
  private trackingEnabled = true;

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
      this.toolCallHistory.push(record);

      logger.debug(
        `Token usage: ${this.currentUsage}/${this.MAX_TOKENS} (${this.getUsagePercentage()}%) | ` +
          `Tool: ${toolName} | Size: ${(totalSize / 1024).toFixed(1)}KB | Tokens: ${estimatedTokens}`
      );

      this.checkWarnings();

      if (this.shouldAutoCleanup()) {
        this.autoCleanup();
      }
    } catch (error) {
      logger.error('Failed to record tool call:', error);
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
  }

  private hasDetailedSummarySize(value: unknown): value is { detailId: unknown; summary: { size: number } } {
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

  private calculateSize(data: unknown): number {
    try {
      // Fast path: if data is a DetailedDataResponse (already summarized), use cached size
      if (this.hasDetailedSummarySize(data)) {
        return Math.min(data.summary.size, this.MAX_ESTIMATION_BYTES);
      }

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
      return stringValue.length > this.MAX_ESTIMATION_STRING_LENGTH
        ? `${stringValue.slice(0, this.MAX_ESTIMATION_STRING_LENGTH)}...[truncated:${stringValue.length}]`
        : stringValue;
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
        `(${this.currentUsage}/${this.MAX_TOKENS}, ${remaining} tokens remaining)`
    );

    if (threshold >= 0.95) {
      logger.warn(' CRITICAL: Consider clearing caches or starting a new session!');
    } else if (threshold >= 0.9) {
      logger.warn('HIGH: Auto-cleanup will trigger soon. Consider using summary modes.');
    } else if (threshold >= 0.8) {
      logger.warn('MODERATE: Monitor usage. Use get_token_budget_stats for details.');
    }
  }

  private shouldAutoCleanup(): boolean {
    const ratio = this.currentUsage / this.MAX_TOKENS;
    return ratio >= this.AUTO_CLEANUP_THRESHOLD;
  }

  private autoCleanup(): void {
    logger.info(' Auto-cleanup triggered at 90% usage...');

    const beforeUsage = this.currentUsage;

    if (this.externalCleanupFn) {
      try {
        this.externalCleanupFn();
        logger.info(' External cleanup callback invoked');
      } catch (e) {
        logger.warn('External cleanup callback failed:', e);
      }
    }

    const cutoff = Date.now() - this.HISTORY_RETENTION;
    const beforeCount = this.toolCallHistory.length;
    this.toolCallHistory = this.toolCallHistory.filter((call) => call.timestamp > cutoff);
    const removedCount = beforeCount - this.toolCallHistory.length;
    logger.info(` Removed ${removedCount} old tool call records`);

    this.recalculateUsage();

    const afterUsage = this.currentUsage;
    const freed = beforeUsage - afterUsage;
    const freedPercentage = Math.round((freed / this.MAX_TOKENS) * 100);

    logger.info(
      ` Cleanup complete! Freed ${freed} tokens (${freedPercentage}%). ` +
        `Usage: ${afterUsage}/${this.MAX_TOKENS} (${this.getUsagePercentage()}%)`
    );

    const newRatio = afterUsage / this.MAX_TOKENS;
    this.warnings = new Set(Array.from(this.warnings).filter((threshold) => newRatio >= threshold));
  }

  private recalculateUsage(): void {
    this.currentUsage = this.toolCallHistory.reduce((sum, call) => sum + call.estimatedTokens, 0);
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
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);

    const suggestions = this.generateSuggestions(topTools);

    const recentCalls = this.toolCallHistory.slice(-20);

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
    topTools: Array<{ tool: string; tokens: number; percentage: number }>
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
            ` ${tool} uses ${percentage}% tokens. Try smartMode="summary" or "priority"`
          );
        } else if (tool.includes('get_script_source')) {
          suggestions.push(` ${tool} uses ${percentage}% tokens. Try preview=true first`);
        } else if (tool.includes('network_get_requests')) {
          suggestions.push(` ${tool} uses ${percentage}% tokens. Reduce limit or use filters`);
        } else if (tool.includes('page_evaluate')) {
          suggestions.push(
            ` ${tool} uses ${percentage}% tokens. Query specific properties instead of full objects`
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
    logger.info(' Manual cleanup requested...');
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
    logger.info(' Resetting token budget...');
    this.currentUsage = 0;
    this.toolCallHistory = [];
    this.warnings.clear();
    this.sessionStartTime = Date.now();
    logger.info(' Token budget reset complete');
  }
}
