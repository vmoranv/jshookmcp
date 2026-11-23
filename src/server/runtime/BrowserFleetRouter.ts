export interface BrowserFleetWorker {
  id: string;
  endpoint?: string;
  weight?: number;
  accepting?: boolean;
}

export interface BrowserFleetLease {
  sessionId: string;
  workerId: string;
  fencingToken: string;
  topologyVersion: number;
  expiresAt: number;
}

export interface BrowserFleetLeaseAcquireRequest {
  sessionId: string;
  preferredWorkerId: string;
  activeWorkerIds: ReadonlySet<string>;
  topologyVersion: number;
  ttlMs: number;
  now: number;
}

export interface BrowserFleetLeaseStoreStats {
  activeLeases: number;
  maxLeases: number | null;
  rejectedLeases: number;
}

/**
 * Production implementations must provide atomic compare-and-set semantics.
 * Redis/etcd adapters can implement this interface without coupling the worker
 * runtime to a specific control-plane dependency.
 */
export interface BrowserFleetLeaseStore {
  get(sessionId: string, now: number): Promise<BrowserFleetLease | null>;
  acquire(request: BrowserFleetLeaseAcquireRequest): Promise<BrowserFleetLease>;
  renew(
    sessionId: string,
    fencingToken: string,
    ttlMs: number,
    now: number,
  ): Promise<BrowserFleetLease | null>;
  release(sessionId: string, fencingToken: string): Promise<boolean>;
  getStats?(now?: number): BrowserFleetLeaseStoreStats;
}

export interface BrowserFleetRouterOptions {
  localWorkerId: string;
  workers?: readonly BrowserFleetWorker[];
  virtualNodes?: number;
  leaseTtlMs?: number;
}

export interface BrowserFleetRoute extends BrowserFleetLease {
  local: boolean;
  endpoint: string | null;
}

export interface BrowserFleetStats {
  localWorkerId: string;
  topologyVersion: number;
  workers: number;
  acceptingWorkers: number;
  ringPoints: number;
  virtualNodes: number;
  leaseTtlMs: number;
  leaseRenewalIntervalMs: number;
  locallyOwnedRoutes: number;
  activeLeaseKeepAlives: number;
  leaseRenewalCount: number;
  leaseLossCount: number;
  leaseStore: BrowserFleetLeaseStoreStats | null;
}

export interface BrowserFleetLeaseRunResult<T> {
  value: T;
  route: BrowserFleetRoute;
}

interface RingPoint {
  hash: number;
  workerId: string;
}

const DEFAULT_VIRTUAL_NODES = 128;
const DEFAULT_LEASE_TTL_MS = 600_000;
const DEFAULT_MAX_LOCAL_LEASES = 4096;
const MAX_WORKER_WEIGHT = 100;
let configuredBrowserFleetLeaseStore: BrowserFleetLeaseStore | null = null;

export function configureBrowserFleetLeaseStore(store: BrowserFleetLeaseStore): void {
  if (
    !store ||
    typeof store.get !== 'function' ||
    typeof store.acquire !== 'function' ||
    typeof store.renew !== 'function' ||
    typeof store.release !== 'function'
  ) {
    throw new TypeError('BrowserFleetLeaseStore must implement get, acquire, renew, and release');
  }
  configuredBrowserFleetLeaseStore = store;
}

export function getConfiguredBrowserFleetLeaseStore(): BrowserFleetLeaseStore | null {
  return configuredBrowserFleetLeaseStore;
}

function normalizeId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must not be empty`);
  return normalized;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

/** Stable unsigned 32-bit hash suitable for a consistent-hash ring. */
export function hashBrowserFleetKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export class BrowserFleetLeaseError extends Error {
  public readonly code:
    | 'BROWSER_FLEET_LEASE_CAPACITY'
    | 'BROWSER_FLEET_WRONG_WORKER'
    | 'BROWSER_FLEET_LEASE_LOST'
    | 'BROWSER_FLEET_WORKER_DRAINING';
  public readonly targetWorkerId: string | null;
  public readonly targetEndpoint: string | null;
  public readonly fencingToken: string | null;
  public readonly retryAfterMs: number | null;
  constructor(
    message: string,
    code:
      | 'BROWSER_FLEET_LEASE_CAPACITY'
      | 'BROWSER_FLEET_WRONG_WORKER'
      | 'BROWSER_FLEET_LEASE_LOST'
      | 'BROWSER_FLEET_WORKER_DRAINING',
    targetWorkerId: string | null = null,
    targetEndpoint: string | null = null,
    fencingToken: string | null = null,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.code = code;
    this.targetWorkerId = targetWorkerId;
    this.targetEndpoint = targetEndpoint;
    this.fencingToken = fencingToken;
    this.retryAfterMs = retryAfterMs;
    this.name = 'BrowserFleetLeaseError';
  }
}

/** Bounded single-process lease store for local mode and tests. */
export class InMemoryBrowserFleetLeaseStore implements BrowserFleetLeaseStore {
  private readonly maxLeases: number;
  private readonly leases = new Map<string, BrowserFleetLease>();
  private nextFencingToken = 1n;
  private rejectedLeases = 0;

  constructor(maxLeases = DEFAULT_MAX_LOCAL_LEASES) {
    this.maxLeases = maxLeases;
    if (!Number.isInteger(maxLeases) || maxLeases < 1) {
      throw new TypeError('maxLeases must be a positive integer');
    }
  }

  async get(sessionId: string, now: number): Promise<BrowserFleetLease | null> {
    const lease = this.leases.get(sessionId);
    if (!lease) return null;
    if (lease.expiresAt <= now) {
      this.leases.delete(sessionId);
      return null;
    }
    return { ...lease };
  }

  async acquire(request: BrowserFleetLeaseAcquireRequest): Promise<BrowserFleetLease> {
    const existing = this.leases.get(request.sessionId);
    if (
      existing &&
      existing.expiresAt > request.now &&
      request.activeWorkerIds.has(existing.workerId)
    ) {
      existing.expiresAt = request.now + request.ttlMs;
      return { ...existing };
    }

    if (existing) this.leases.delete(request.sessionId);
    if (this.leases.size >= this.maxLeases) this.evictExpired(request.now);
    if (this.leases.size >= this.maxLeases) {
      this.rejectedLeases += 1;
      throw new BrowserFleetLeaseError(
        `Browser fleet lease store is full (${this.leases.size}/${this.maxLeases})`,
        'BROWSER_FLEET_LEASE_CAPACITY',
        null,
        null,
        null,
        request.ttlMs,
      );
    }

    const lease: BrowserFleetLease = {
      sessionId: request.sessionId,
      workerId: request.preferredWorkerId,
      fencingToken: String(this.nextFencingToken++),
      topologyVersion: request.topologyVersion,
      expiresAt: request.now + request.ttlMs,
    };
    this.leases.set(request.sessionId, lease);
    return { ...lease };
  }

  async renew(
    sessionId: string,
    fencingToken: string,
    ttlMs: number,
    now: number,
  ): Promise<BrowserFleetLease | null> {
    const lease = this.leases.get(sessionId);
    if (!lease || lease.fencingToken !== fencingToken || lease.expiresAt <= now) return null;
    lease.expiresAt = now + ttlMs;
    return { ...lease };
  }

  async release(sessionId: string, fencingToken: string): Promise<boolean> {
    const lease = this.leases.get(sessionId);
    if (!lease || lease.fencingToken !== fencingToken) return false;
    return this.leases.delete(sessionId);
  }

  getStats(now?: number): BrowserFleetLeaseStoreStats {
    if (typeof now === 'number') this.evictExpired(now);
    return {
      activeLeases: this.leases.size,
      maxLeases: this.maxLeases,
      rejectedLeases: this.rejectedLeases,
    };
  }

  private evictExpired(now: number): void {
    for (const [sessionId, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(sessionId);
    }
  }
}

/**
 * Consistent-hash directory plus a fencing lease boundary.
 *
 * The router does not forward tool calls. A gateway uses routeSession(), while a
 * worker uses assertLocal() before admitting browser work.
 */
export class BrowserFleetRouter {
  private readonly leaseStore: BrowserFleetLeaseStore;
  private readonly now: () => number;
  private readonly localWorkerId: string;
  private readonly virtualNodes: number;
  private readonly leaseTtlMs: number;
  private readonly workers = new Map<string, BrowserFleetWorker>();
  private readonly locallyOwnedRoutes = new Map<string, BrowserFleetRoute>();
  private ring: RingPoint[] = [];
  private activeWorkerIds = new Set<string>();
  private acceptingWorkerIds = new Set<string>();
  private topologyVersion = 0;
  private activeLeaseKeepAlives = 0;
  private leaseRenewalCount = 0;
  private leaseLossCount = 0;

  constructor(
    options: BrowserFleetRouterOptions,
    leaseStore: BrowserFleetLeaseStore = new InMemoryBrowserFleetLeaseStore(),
    now: () => number = () => Date.now(),
  ) {
    this.leaseStore = leaseStore;
    this.now = now;
    this.localWorkerId = normalizeId(options.localWorkerId, 'localWorkerId');
    this.virtualNodes = positiveInteger(options.virtualNodes, DEFAULT_VIRTUAL_NODES);
    this.leaseTtlMs = positiveInteger(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS);
    this.setWorkers(options.workers ?? [{ id: this.localWorkerId }]);
  }

  setWorkers(workers: readonly BrowserFleetWorker[]): void {
    const next = new Map<string, BrowserFleetWorker>();
    for (const worker of workers) {
      const id = normalizeId(worker.id, 'worker id');
      if (next.has(id)) throw new TypeError(`Duplicate browser fleet worker id: ${id}`);
      next.set(id, {
        id,
        ...(worker.endpoint?.trim() ? { endpoint: worker.endpoint.trim() } : {}),
        weight: Math.min(MAX_WORKER_WEIGHT, positiveInteger(worker.weight, 1)),
        accepting: worker.accepting !== false,
      });
    }
    if (next.size === 0) throw new TypeError('Browser fleet must contain at least one worker');

    const ring: RingPoint[] = [];
    const activeIds = new Set<string>();
    for (const worker of next.values()) {
      if (worker.accepting === false) continue;
      activeIds.add(worker.id);
      const points = this.virtualNodes * (worker.weight ?? 1);
      for (let index = 0; index < points; index += 1) {
        ring.push({
          hash: hashBrowserFleetKey(`${worker.id}\0${index}`),
          workerId: worker.id,
        });
      }
    }
    if (ring.length === 0) throw new TypeError('Browser fleet must have an accepting worker');
    ring.sort(
      (left, right) => left.hash - right.hash || left.workerId.localeCompare(right.workerId),
    );

    this.workers.clear();
    for (const [id, worker] of next) this.workers.set(id, worker);
    this.ring = ring;
    // Draining workers remain valid lease owners but receive no new affinity.
    // Remove a worker from the topology only after its leases and in-flight work drain.
    this.activeWorkerIds = new Set(next.keys());
    this.acceptingWorkerIds = activeIds;
    this.topologyVersion += 1;
  }

  getAssignedWorker(sessionId: string): BrowserFleetWorker {
    const normalized = normalizeId(sessionId, 'sessionId');
    const hash = hashBrowserFleetKey(normalized);
    let low = 0;
    let high = this.ring.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.ring[middle]!.hash < hash) low = middle + 1;
      else high = middle;
    }
    const point = this.ring[low === this.ring.length ? 0 : low]!;
    return this.workers.get(point.workerId)!;
  }

  async routeSession(sessionId: string): Promise<BrowserFleetRoute> {
    const normalized = normalizeId(sessionId, 'sessionId');
    const preferred = this.getAssignedWorker(normalized);
    const lease = await this.leaseStore.acquire({
      sessionId: normalized,
      preferredWorkerId: preferred.id,
      activeWorkerIds: this.activeWorkerIds,
      topologyVersion: this.topologyVersion,
      ttlMs: this.leaseTtlMs,
      now: this.now(),
    });
    const worker = this.workers.get(lease.workerId);
    const route = {
      ...lease,
      local: lease.workerId === this.localWorkerId,
      endpoint: worker?.endpoint ?? null,
    };
    if (route.local) this.locallyOwnedRoutes.set(normalized, route);
    else this.locallyOwnedRoutes.delete(normalized);
    return route;
  }

  async claimLocalSession(sessionId: string): Promise<BrowserFleetRoute> {
    const normalized = normalizeId(sessionId, 'sessionId');
    if (!this.acceptingWorkerIds.has(this.localWorkerId)) {
      throw new BrowserFleetLeaseError(
        `Browser worker ${this.localWorkerId} is draining and cannot accept new sessions`,
        'BROWSER_FLEET_WORKER_DRAINING',
        this.localWorkerId,
        this.workers.get(this.localWorkerId)?.endpoint ?? null,
        null,
        this.leaseTtlMs,
      );
    }
    // A live remote lease is sticky in the store: acquire() would renew it and
    // return the remote worker, only for assertLocal() to fail afterwards (and
    // we would have extended someone else's lease as a side effect).
    const existing = await this.leaseStore.get(normalized, this.now());
    if (
      existing &&
      this.activeWorkerIds.has(existing.workerId) &&
      existing.workerId !== this.localWorkerId
    ) {
      throw this.remoteLeaseError(normalized, existing);
    }
    const lease = await this.leaseStore.acquire({
      sessionId: normalized,
      preferredWorkerId: this.localWorkerId,
      activeWorkerIds: this.activeWorkerIds,
      topologyVersion: this.topologyVersion,
      ttlMs: this.leaseTtlMs,
      now: this.now(),
    });
    const worker = this.workers.get(lease.workerId);
    const route: BrowserFleetRoute = {
      ...lease,
      local: lease.workerId === this.localWorkerId,
      endpoint: worker?.endpoint ?? null,
    };
    this.assertLocal(route);
    this.locallyOwnedRoutes.set(normalized, route);
    return route;
  }

  async admitLocalSession(sessionId: string): Promise<BrowserFleetRoute> {
    const normalized = normalizeId(sessionId, 'sessionId');
    const preferred = this.getAssignedWorker(normalized);
    const stored = await this.leaseStore.get(normalized, this.now());
    const existing = stored && this.activeWorkerIds.has(stored.workerId) ? stored : null;
    if (existing?.workerId === this.localWorkerId) {
      const route = await this.renewSession({
        ...existing,
        local: true,
        endpoint: this.workers.get(existing.workerId)?.endpoint ?? null,
      });
      if (route) return route;
    }
    // Do not fall through to routeSession(): acquire() renews a valid remote
    // lease and returns it, so assertLocal() would throw only after extending
    // a lease for a worker this admission path must not touch.
    if (existing && existing.workerId !== this.localWorkerId) {
      throw this.remoteLeaseError(normalized, existing);
    }
    if (preferred.id !== this.localWorkerId) {
      const targetWorker = existing ? this.workers.get(existing.workerId) : preferred;
      throw new BrowserFleetLeaseError(
        `Browser session ${normalized} is assigned to worker ${targetWorker?.id ?? preferred.id}`,
        'BROWSER_FLEET_WRONG_WORKER',
        targetWorker?.id ?? preferred.id,
        targetWorker?.endpoint ?? null,
        existing?.fencingToken ?? null,
        0,
      );
    }
    const route = await this.routeSession(normalized);
    this.assertLocal(route);
    return route;
  }

  assertLocal(route: BrowserFleetRoute): void {
    if (route.local) return;
    throw new BrowserFleetLeaseError(
      `Browser session ${route.sessionId} is assigned to worker ${route.workerId}`,
      'BROWSER_FLEET_WRONG_WORKER',
      route.workerId,
      route.endpoint,
      route.fencingToken,
      0,
    );
  }

  async renewSession(route: BrowserFleetRoute): Promise<BrowserFleetRoute | null> {
    const renewed = await this.leaseStore.renew(
      route.sessionId,
      route.fencingToken,
      this.leaseTtlMs,
      this.now(),
    );
    if (!renewed) return null;
    this.leaseRenewalCount += 1;
    const worker = this.workers.get(renewed.workerId);
    const next = {
      ...renewed,
      local: renewed.workerId === this.localWorkerId,
      endpoint: worker?.endpoint ?? null,
    };
    if (next.local) this.locallyOwnedRoutes.set(next.sessionId, next);
    else this.locallyOwnedRoutes.delete(next.sessionId);
    return next;
  }

  /** Keeps a lease live for one non-preemptive browser operation. */
  async runWithLeaseKeepAlive<T>(
    route: BrowserFleetRoute,
    run: () => Promise<T>,
  ): Promise<BrowserFleetLeaseRunResult<T>> {
    const initial = await this.renewSession(route);
    if (!initial) {
      this.leaseLossCount += 1;
      throw this.leaseLostError(route);
    }
    this.assertLocal(initial);

    let current = initial;
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    let renewal: Promise<void> | null = null;
    let leaseFailure: BrowserFleetLeaseError | null = null;
    const renewalIntervalMs = this.getLeaseRenewalIntervalMs();

    const scheduleRenewal = (): void => {
      timer = setTimeout(() => {
        timer = null;
        renewal = (async () => {
          try {
            const renewed = await this.renewSession(current);
            if (!renewed) {
              this.leaseLossCount += 1;
              leaseFailure = this.leaseLostError(current);
              return;
            }
            this.assertLocal(renewed);
            current = renewed;
          } catch (error) {
            this.leaseLossCount += 1;
            leaseFailure =
              error instanceof BrowserFleetLeaseError ? error : this.leaseLostError(current, error);
          }
        })().finally(() => {
          renewal = null;
          if (!stopped && !leaseFailure) scheduleRenewal();
        });
      }, renewalIntervalMs);
      timer.unref();
    };

    this.activeLeaseKeepAlives += 1;
    scheduleRenewal();
    try {
      const value = await run();
      stopped = true;
      if (timer) clearTimeout(timer);
      if (renewal) await renewal;
      if (leaseFailure) throw leaseFailure;
      return { value, route: current };
    } finally {
      stopped = true;
      if (timer) clearTimeout(timer);
      await (renewal as Promise<void> | null)?.catch(() => undefined);
      this.activeLeaseKeepAlives = Math.max(0, this.activeLeaseKeepAlives - 1);
    }
  }

  async releaseSession(
    route: Pick<BrowserFleetLease, 'sessionId' | 'fencingToken'>,
  ): Promise<boolean> {
    const released = await this.leaseStore.release(route.sessionId, route.fencingToken);
    if (released) this.locallyOwnedRoutes.delete(route.sessionId);
    return released;
  }

  async releaseLocalSession(sessionId: string): Promise<boolean> {
    const normalized = normalizeId(sessionId, 'sessionId');
    const route = this.locallyOwnedRoutes.get(normalized);
    if (!route) return false;
    return await this.releaseSession(route);
  }

  getStats(): BrowserFleetStats {
    const now = this.now();
    for (const [sessionId, route] of this.locallyOwnedRoutes) {
      if (route.expiresAt <= now) this.locallyOwnedRoutes.delete(sessionId);
    }
    return {
      localWorkerId: this.localWorkerId,
      topologyVersion: this.topologyVersion,
      workers: this.workers.size,
      acceptingWorkers: this.acceptingWorkerIds.size,
      ringPoints: this.ring.length,
      virtualNodes: this.virtualNodes,
      leaseTtlMs: this.leaseTtlMs,
      leaseRenewalIntervalMs: this.getLeaseRenewalIntervalMs(),
      locallyOwnedRoutes: this.locallyOwnedRoutes.size,
      activeLeaseKeepAlives: this.activeLeaseKeepAlives,
      leaseRenewalCount: this.leaseRenewalCount,
      leaseLossCount: this.leaseLossCount,
      leaseStore: this.leaseStore.getStats?.(now) ?? null,
    };
  }

  private getLeaseRenewalIntervalMs(): number {
    return Math.max(1, Math.floor(this.leaseTtlMs / 3));
  }

  private remoteLeaseError(sessionId: string, lease: BrowserFleetLease): BrowserFleetLeaseError {
    const worker = this.workers.get(lease.workerId);
    return new BrowserFleetLeaseError(
      `Browser session ${sessionId} is assigned to worker ${lease.workerId}`,
      'BROWSER_FLEET_WRONG_WORKER',
      lease.workerId,
      worker?.endpoint ?? null,
      lease.fencingToken,
      0,
    );
  }

  private leaseLostError(route: BrowserFleetRoute, cause?: unknown): BrowserFleetLeaseError {
    return new BrowserFleetLeaseError(
      `Browser fleet lease was lost for session ${route.sessionId}` +
        (cause instanceof Error ? `: ${cause.message}` : ''),
      'BROWSER_FLEET_LEASE_LOST',
      route.workerId,
      route.endpoint,
      route.fencingToken,
      0,
    );
  }
}
