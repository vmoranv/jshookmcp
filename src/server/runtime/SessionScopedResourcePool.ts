import { getToolRequestContext } from '@server/runtime/ToolRequestContext';
import { logger } from '@utils/logger';
import type { MCPConfig } from '@internal-types/config';

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_MAX_RESOURCES = 4096;
const DEFAULT_IDLE_TTL_MS = 600_000;

type ResourceDisposer<T extends object> = (resource: T) => void | Promise<void>;

export interface SessionScopedResourcePoolOptions {
  maxResources?: number;
  idleTtlMs?: number;
  now?: () => number;
}

export function sessionResourcePoolOptions(
  config: MCPConfig | null | undefined,
): SessionScopedResourcePoolOptions {
  return {
    // The stable proxy owns one default target in addition to routed HTTP sessions.
    maxResources: (config?.browserFleetMaxLocalLeases ?? DEFAULT_MAX_RESOURCES) + 1,
    idleTtlMs: config?.browserFleetLeaseTtlMs ?? DEFAULT_IDLE_TTL_MS,
  };
}

interface ResourceEntry<T extends object> {
  resource: T;
  lastTouchedAt: number;
  inFlight: number;
  disposeWhenIdle: boolean;
  /** Cached disposal promise so close()/dropSession() never dispose twice. */
  disposal: Promise<void> | null;
  /** Resolvers waiting for the last in-flight invocation to settle. */
  idleWaiters: Array<() => void>;
}

export class SessionScopedResourcePoolCapacityError extends Error {
  public readonly size: number;
  public readonly limit: number;
  public readonly retryAfterMs: number;
  readonly code = 'SESSION_RESOURCE_POOL_CAPACITY';

  constructor(size: number, limit: number, retryAfterMs: number) {
    super(`Session resource pool is full (${size}/${limit})`);
    this.size = size;
    this.limit = limit;
    this.retryAfterMs = retryAfterMs;
    this.name = 'SessionScopedResourcePoolCapacityError';
  }
}

/**
 * Lazily creates one mutable runtime resource per MCP session while exposing a
 * stable proxy that existing domain handlers can keep as a dependency.
 */
export class SessionScopedResourcePool<T extends object> {
  private readonly createResource: (sessionId: string) => T;
  private readonly disposeResource?: ResourceDisposer<T>;
  private readonly resources = new Map<string, ResourceEntry<T>>();
  private proxy: T | null = null;
  private readonly maxResources: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;
  private closed = false;

  constructor(
    createResource: (sessionId: string) => T,
    disposeResource?: ResourceDisposer<T>,
    options: SessionScopedResourcePoolOptions = {},
  ) {
    this.createResource = createResource;
    this.disposeResource = disposeResource;
    this.maxResources = this.positiveInteger(options.maxResources, DEFAULT_MAX_RESOURCES);
    this.idleTtlMs = this.positiveInteger(options.idleTtlMs, DEFAULT_IDLE_TTL_MS);
    this.now = options.now ?? (() => Date.now());
  }

  normalizeSessionId(sessionId: string | null | undefined): string {
    return typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : DEFAULT_SESSION_ID;
  }

  getCurrentSessionId(): string {
    return this.normalizeSessionId(getToolRequestContext()?.sessionId);
  }

  getForSession(sessionId: string | null | undefined): T {
    if (this.closed) {
      throw new Error('Session resource pool is closed');
    }
    const normalized = this.normalizeSessionId(sessionId);
    let entry = this.resources.get(normalized);
    if (!entry) {
      this.evictExpired();
      if (this.resources.size >= this.maxResources) {
        throw new SessionScopedResourcePoolCapacityError(
          this.resources.size,
          this.maxResources,
          this.idleTtlMs,
        );
      }
      entry = {
        resource: this.createResource(normalized),
        lastTouchedAt: this.now(),
        inFlight: 0,
        disposeWhenIdle: false,
        disposal: null,
        idleWaiters: [],
      };
      this.resources.set(normalized, entry);
    } else {
      entry.lastTouchedAt = this.now();
    }
    return entry.resource;
  }

  getCurrent(): T {
    return this.getForSession(this.getCurrentSessionId());
  }

  getProxy(): T {
    if (this.proxy) return this.proxy;

    const target = this.getForSession(DEFAULT_SESSION_ID);
    this.proxy = new Proxy(target, {
      get: (_target, property) => {
        const entry = this.getCurrentEntry();
        const value = Reflect.get(entry.resource, property, entry.resource) as unknown;
        if (typeof value !== 'function') return value;
        // Resolve the entry and method at CALL time, not property-read time:
        // dropSession()/evictExpired() may dispose this entry in between, and a
        // captured reference would use-after-dispose and double-dispose it.
        return (...args: unknown[]) => {
          const current = this.getCurrentEntry();
          const currentValue = Reflect.get(current.resource, property, current.resource) as unknown;
          if (typeof currentValue !== 'function') return currentValue;
          return this.invoke(current, currentValue, args);
        };
      },
      set: (_target, property, value) => {
        const entry = this.getCurrentEntry();
        return Reflect.set(entry.resource, property, value, entry.resource);
      },
    });
    return this.proxy;
  }

  has(sessionId: string | null | undefined): boolean {
    return this.resources.has(this.normalizeSessionId(sessionId));
  }

  get size(): number {
    return this.resources.size;
  }

  async dropSession(sessionId: string | null | undefined): Promise<boolean> {
    const normalized = this.normalizeSessionId(sessionId);
    const entry = this.resources.get(normalized);
    if (!entry) return false;
    this.resources.delete(normalized);
    if (entry.inFlight > 0) entry.disposeWhenIdle = true;
    else await this.scheduleDisposal(entry);
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.proxy = null;
    const resources = [...this.resources.entries()];
    this.resources.clear();
    await Promise.allSettled(
      resources.map(async ([, entry]) => {
        if (entry.inFlight > 0) {
          entry.disposeWhenIdle = true;
          // Wait for the last in-flight call before resolving close(), so the
          // pool has actually released its resources (bounded by the caller's
          // own shutdown timeout).
          await this.waitForIdle(entry);
        }
        await this.scheduleDisposal(entry);
      }),
    );
  }

  getStats(): {
    size: number;
    maxResources: number;
    idleTtlMs: number;
    inFlight: number;
  } {
    let inFlight = 0;
    for (const entry of this.resources.values()) inFlight += entry.inFlight;
    return {
      size: this.resources.size,
      maxResources: this.maxResources,
      idleTtlMs: this.idleTtlMs,
      inFlight,
    };
  }

  private getCurrentEntry(): ResourceEntry<T> {
    const sessionId = this.getCurrentSessionId();
    this.getForSession(sessionId);
    return this.resources.get(sessionId)!;
  }

  private invoke(entry: ResourceEntry<T>, method: Function, args: unknown[]): unknown {
    entry.inFlight += 1;
    entry.lastTouchedAt = this.now();
    let result: unknown;
    try {
      result = Reflect.apply(method, entry.resource, args);
    } catch (error) {
      this.finishInvocation(entry);
      throw error;
    }
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).finally(() => this.finishInvocation(entry));
    }
    this.finishInvocation(entry);
    return result;
  }

  private finishInvocation(entry: ResourceEntry<T>): void {
    entry.inFlight = Math.max(0, entry.inFlight - 1);
    entry.lastTouchedAt = this.now();
    if (entry.inFlight === 0) {
      const waiters = entry.idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
      if (entry.disposeWhenIdle) {
        void this.scheduleDisposal(entry);
      }
    }
  }

  private waitForIdle(entry: ResourceEntry<T>): Promise<void> {
    if (entry.inFlight === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      entry.idleWaiters.push(resolve);
    });
  }

  /** Dispose at most once per entry; log failures instead of orphaning them. */
  private scheduleDisposal(entry: ResourceEntry<T>): Promise<void> {
    if (entry.disposal) return entry.disposal;
    entry.disposal = this.disposeEntry(entry).catch((error: unknown) => {
      logger.warn(
        `[session-resource] Deferred disposal failed: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return entry.disposal;
  }

  private evictExpired(): void {
    if (this.resources.size < this.maxResources) return;
    const cutoff = this.now() - this.idleTtlMs;
    for (const [sessionId, entry] of this.resources) {
      if (entry.inFlight > 0 || entry.lastTouchedAt > cutoff) continue;
      this.resources.delete(sessionId);
      void this.scheduleDisposal(entry);
      if (this.resources.size < this.maxResources) return;
    }
  }

  private async disposeEntry(entry: ResourceEntry<T>): Promise<void> {
    if (!this.disposeResource) return;
    await this.disposeResource(entry.resource);
  }

  private positiveInteger(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1
      ? Math.floor(value)
      : fallback;
  }
}
