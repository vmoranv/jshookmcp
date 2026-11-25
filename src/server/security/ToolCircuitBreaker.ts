import { logger } from '@utils/logger';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';

export interface CircuitBreakerState {
  toolName: string;
  failureCount: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

export type CircuitBreakerEventHandler = (event: 'opened' | 'recovered', toolName: string) => void;

const FAILURE_THRESHOLD = 3;
const RECOVERY_MS = 30_000;
const HALF_OPEN_MAX_CALLS = 1;
/**
 * Deadline for an admitted half-open probe. The probe slot is consumed on
 * admission, so a call that never reaches recordSuccess/recordFailure (early
 * validation rejection, caller abort, thrown outside telemetry) would otherwise
 * wedge the tool in half-open forever. When the deadline lapses the breaker
 * re-opens and, after a fresh recovery window, admits a new probe.
 */
const HALF_OPEN_PROBE_TIMEOUT_MS = 60_000;

export class ToolCircuitBreaker {
  private readonly states = new Map<string, CircuitBreakerState>();
  private readonly halfOpenCalls = new Map<string, number>();
  /** When the currently admitted half-open probe was handed out. */
  private readonly halfOpenStartedAt = new Map<string, number>();
  private readonly listeners = new Set<CircuitBreakerEventHandler>();

  private stateKey(toolName: string): string {
    const sessionId = getToolRequestContext()?.sessionId ?? 'default';
    return `${sessionId}\u0000${toolName}`;
  }

  onChange(handler: CircuitBreakerEventHandler): void {
    this.listeners.add(handler);
  }

  private emit(event: 'opened' | 'recovered', toolName: string): void {
    for (const handler of this.listeners) {
      try {
        handler(event, toolName);
      } catch {
        // listener errors must not break the breaker
      }
    }
  }

  getState(toolName: string): CircuitBreakerState | undefined {
    return this.states.get(this.stateKey(toolName));
  }

  shouldBlock(toolName: string): boolean {
    const key = this.stateKey(toolName);
    const entry = this.states.get(key);
    if (!entry) return false;

    if (entry.state === 'closed') return false;

    if (entry.state === 'open') {
      const elapsed = Date.now() - entry.lastFailureTime;
      if (elapsed >= RECOVERY_MS) {
        entry.state = 'half-open';
        this.halfOpenCalls.set(key, 1);
        this.halfOpenStartedAt.set(key, Date.now());
        logger.info(`[CircuitBreaker] ${toolName}: open → half-open`);
        return false;
      }
      return true;
    }

    if (entry.state === 'half-open') {
      const startedAt = this.halfOpenStartedAt.get(key);
      if (startedAt !== undefined && Date.now() - startedAt >= HALF_OPEN_PROBE_TIMEOUT_MS) {
        // The probe was never reported back. Re-open rather than block forever;
        // a fresh recovery window later admits a new probe.
        entry.state = 'open';
        entry.lastFailureTime = Date.now();
        this.halfOpenCalls.delete(key);
        this.halfOpenStartedAt.delete(key);
        logger.warn(`[CircuitBreaker] ${toolName}: half-open probe timed out → open`);
        return true;
      }
      const calls = this.halfOpenCalls.get(key) ?? 0;
      if (calls >= HALF_OPEN_MAX_CALLS) return true;
      this.halfOpenCalls.set(key, calls + 1);
      return false;
    }

    return false;
  }

  recordSuccess(toolName: string): void {
    const key = this.stateKey(toolName);
    const entry = this.states.get(key);
    if (!entry) return;

    if (entry.state === 'half-open') {
      entry.state = 'closed';
      entry.failureCount = 0;
      this.halfOpenCalls.delete(key);
      this.halfOpenStartedAt.delete(key);
      logger.info(`[CircuitBreaker] ${toolName}: half-open → closed`);
      this.emit('recovered', toolName);
      return;
    }

    entry.failureCount = 0;
  }

  recordFailure(toolName: string): void {
    const key = this.stateKey(toolName);
    let entry = this.states.get(key);
    if (!entry) {
      entry = {
        toolName,
        failureCount: 0,
        lastFailureTime: 0,
        state: 'closed',
      };
      this.states.set(key, entry);
    }

    entry.failureCount++;
    entry.lastFailureTime = Date.now();

    if (entry.state === 'half-open') {
      entry.state = 'open';
      this.halfOpenCalls.delete(key);
      this.halfOpenStartedAt.delete(key);
      logger.warn(`[CircuitBreaker] ${toolName}: half-open → open (probe failed)`);
      this.emit('opened', toolName);
      return;
    }

    if (entry.state === 'closed' && entry.failureCount >= FAILURE_THRESHOLD) {
      entry.state = 'open';
      logger.warn(
        `[CircuitBreaker] ${toolName}: closed → open (${entry.failureCount} consecutive failures)`,
      );
      this.emit('opened', toolName);
    }
  }

  getStates(): CircuitBreakerState[] {
    return Array.from(this.states.values());
  }

  reset(toolName: string): void {
    const key = this.stateKey(toolName);
    this.states.delete(key);
    this.halfOpenCalls.delete(key);
  }

  getRecoveryMs(): number {
    return RECOVERY_MS;
  }
}
