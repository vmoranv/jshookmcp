/**
 * EventBus — type-safe publish/subscribe event bus for decoupling MCPServer internals.
 *
 * Replaces direct domain-to-server coupling with a central event dispatch.
 * Supports async listeners, one-time subscriptions, and wildcard listeners.
 */

import { getToolRequestContext } from '@server/runtime/ToolRequestContext';

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

/** Core event map — extend via module augmentation for domain-specific events. */
export interface ServerEventMap {
  /**
   * There is deliberately NO `[key: string]: unknown` index signature here.
   *
   * One used to be, and it silently disabled event typing for the whole repo:
   * an index signature widens `keyof ServerEventMap` to `string | number`, so
   * `EventBus.emit<K extends keyof TMap>`, `emitBusEvent` and `on` all accepted
   * any string at all. Wrong event names compiled, and payloads were checked
   * against the union of every event's payload instead of their own.
   *
   * Removing the signature surfaced five events that were being emitted
   * undeclared and unchecked: `frida:spawned`, `network:http2_probed`,
   * `network:http2_frame_build_completed`, `network:rtt_measured` and
   * `task:update`. `scripts/audit-event-contracts.mjs` fails the build if the
   * signature ever comes back.
   *
   * ONE event below is declared with no producer: `domain:unloaded`. It is
   * groundwork, not dead code — kept because the registry has no teardown path
   * to report. See `UNEMITTED_EVENT_BASELINE` in
   * `scripts/audit-event-contracts.mjs` for the evidence (caches are
   * append-only; AutoPruner and the domain TTL only change VISIBILITY, which is
   * not an unload).
   *
   * The other ten events that used to sit in the same gap were WIRED on
   * 2026-09-24 rather than documented away: `tool:activated`/`tool:deactivated`
   * (MCPServer.search.handlers.activate.ts), `domain:loaded`
   * (registry/discovery.ts + registry/index.ts), `extension:loaded`/
   * `extension:unloaded` (extension-registry/PluginRegistry.ts),
   * `session:browser_launched`/`session:browser_closed`
   * (browser/handlers/browser-control.ts), `network:dns_resolved`/
   * `network:dns_reversed` (network/handlers/raw-dns-http-handlers.ts), and
   * `task:update` (tasks/TaskManager.ts — its `SseStream` subscriber at
   * src/server/http/SseStream.ts:62 can now actually fire; note `SseStream.ts:68`
   * calls `sendEvent`, which forwards to an HTTP client and is NOT a producer).
   *
   * `scripts/audit-event-contracts.mjs` enforces this as check 9. It fails when
   * a NEW declared-but-unemitted name appears, when a baseline name is no longer
   * declared at all, and when a baseline name GAINS a producer (that entry is
   * then stale and must be deleted from the baseline, otherwise the guard would
   * silently exempt a live event). So: wire the emitter rather than deleting the
   * declaration, and never silence the guard by adding a name to the baseline
   * without naming the call site that will emit it.
   */
  'tool:activated': { toolName: string; domain: string; timestamp: string };
  'tool:deactivated': { toolName: string; domain: string; timestamp: string };
  /**
   * Unified event-stream catalog (mirrored to GET /events SSE subscribers).
   *
   * Payload contract: METADATA ONLY. Tool arguments, results and response
   * bodies must never be attached — these events are broadcast to any
   * authenticated /events subscriber. See src/server/http/EventsEndpoint.ts
   * for the SSE allowlist mirror.
   */
  'tool.execution.started': {
    toolName: string;
    domain: string | null;
    sessionId: string | null;
    timestamp: string;
  };
  'tool.execution.finished': {
    toolName: string;
    domain: string | null;
    sessionId: string | null;
    durationMs: number;
    ok: boolean;
    /** Truncated error message only (no args/result payloads). Absent on success. */
    errorSummary?: string;
    timestamp: string;
  };
  'tool.gate.denied': {
    toolName: string;
    /** Which gate mechanism denied the call. */
    source: 'allowTools' | 'rules' | 'doom-loop';
    /** Matched permission rule (static config — never runtime args). */
    rule: { tool: string; pattern?: string; action: 'allow' | 'deny' } | null;
    consecutiveCount?: number;
    threshold?: number;
    sessionId: string | null;
    timestamp: string;
  };
  'tool.activation.changed': {
    action: 'activated' | 'deactivated' | 'budget-rejected' | 'lru-evicted';
    toolNames: string[];
    timestamp: string;
  };
  'tool:called': {
    toolName: string;
    domain: string | null;
    sessionId?: string | null;
    timestamp: string;
    success: boolean;
    /** Wall-clock duration of the completed call (ms). Absent on pre-duration emitters. */
    durationMs?: number;
    /**
     * Why the call failed, when the pipeline knows. Absent on success and on
     * emitters that predate error classification. The trace recorder forwards
     * it verbatim; it never re-derives a cause from the message.
     */
    errorKind?: 'timeout' | 'validation' | 'gate' | 'handler' | 'unknown';
    args?: Record<string, unknown>;
    result?: {
      success?: boolean;
      isError?: boolean;
    };
  };
  'domain:loaded': { domain: string; toolCount: number; timestamp: string };
  'domain:unloaded': { domain: string; timestamp: string };
  'extension:loaded': { pluginId: string; toolCount: number; source: string; timestamp: string };
  'extension:unloaded': { pluginId: string; timestamp: string };
  'session:browser_launched': { mode: string; timestamp: string };
  'session:browser_closed': { reason: string; timestamp: string };
  'debugger:breakpoint_hit': { scriptId: string; lineNumber: number; timestamp: string };
  'browser:navigated': { url: string; timestamp: string };
  'memory:scan_completed': { scanType: string; resultCount: number; timestamp: string };
  'activation:domain_boosted': { domain: string; reason: string; timestamp: string };
  'activation:domain_pruned': { domain: string; reason: string; timestamp: string };
  'tool:progress': {
    progressToken: string | number;
    progress: number;
    total?: number;
    timestamp: string;
  };
  /**
   * Task progress mirrored to SSE subscribers by `src/server/http/SseStream.ts`.
   * SseStream is not constructed anywhere under src/ yet, so nothing emits this
   * today — declared so the subscription is type-checked. The general
   * missing-producer check lives in scripts/audit-event-contracts.mjs.
   */
  'task:update': {
    taskId: string;
    status: string;
    sessionId?: string;
    timestamp: string;
    data?: Record<string, unknown>;
  };
  'evidence:updated': { timestamp: string; reason: string };
  'evidence-evicted': {
    reason: 'node-cap' | 'edge-cap';
    droppedNodes: number;
    droppedEdges: number;
    timestamp: string;
  };
  'network:intercept_started': { interceptType: string; timestamp: string };
  'network:dns_resolved': { hostname: string; count: number; timestamp: string };
  'network:dns_reversed': { address: string; count: number; timestamp: string };
  'network:http_request_built': {
    method: string;
    target: string;
    byteLength: number;
    timestamp: string;
  };
  'network:http_plain_request_completed': {
    host: string;
    port: number;
    statusCode: number | null;
    byteLength: number;
    timestamp: string;
  };
  // Renamed from `network:http2_probe_completed`, which nothing referenced
  // except its own declaration — the emitter and its tests already used this
  // name, so the declared key was a ghost that could never be emitted.
  'network:http2_probed': {
    url: string;
    statusCode: number | null;
    alpnProtocol: string | null;
    success: boolean;
    timestamp: string;
  };
  'network:http2_frame_parsed': {
    frameType: string;
    typeCode: number;
    streamId: number;
    payloadBytes: number;
    timestamp: string;
  };
  'network:http2_frame_build_completed': {
    frameType: string;
    typeCode: number;
    streamId: number;
    flags: number;
    payloadBytes: number;
    timestamp: string;
  };
  'network:rtt_measured': {
    url: string;
    probeType: string;
    iterations: number;
    successCount: number;
    errorCount: number;
    stats: {
      count: number;
      minMs: number;
      maxMs: number;
      avgMs: number;
      p50Ms: number;
      p90Ms: number;
      p95Ms: number;
      p99Ms: number;
    } | null;
    timestamp: string;
  };
  'network:http2_fingerprint_computed': {
    hash: string;
    frameCount: number;
    timestamp: string;
  };
  'network:grpc_frame_parsed': {
    messageCount: number;
    totalBytes: number;
    timestamp: string;
  };
  'network:grpc_frame_built': {
    messageCount: number;
    bytes: number;
    timestamp: string;
  };
  'v8:heap_captured': { snapshotId: string; sizeBytes: number; timestamp: string };
  'tls:keylog_started': { filePath: string; timestamp: string };
  'tls:probe_completed': { host: string; port: number; success: boolean; timestamp: string };
  'tls:session_opened': { sessionId: string; host: string; port: number; timestamp: string };
  'tls:session_closed': { sessionId: string; reason: string | null; timestamp: string };
  'tls:session_written': { sessionId: string; byteLength: number; timestamp: string };
  'tls:session_read': {
    sessionId: string;
    byteLength: number;
    matched: boolean;
    timestamp: string;
  };
  'websocket:session_opened': {
    sessionId: string;
    scheme: 'ws' | 'wss';
    host: string;
    port: number;
    path: string;
    timestamp: string;
  };
  'websocket:session_written': {
    sessionId: string;
    frameType: 'text' | 'binary' | 'close' | 'ping' | 'pong';
    byteLength: number;
    automatic: boolean;
    timestamp: string;
  };
  'websocket:frame_read': {
    sessionId: string;
    frameType: 'text' | 'binary' | 'close' | 'ping' | 'pong';
    byteLength: number;
    timestamp: string;
  };
  'websocket:session_closed': {
    sessionId: string;
    reason: string | null;
    timestamp: string;
  };
  'tcp:session_opened': { sessionId: string; host: string; port: number; timestamp: string };
  'tcp:session_closed': { sessionId: string; reason: string | null; timestamp: string };
  'tcp:session_written': { sessionId: string; byteLength: number; timestamp: string };
  'tcp:session_read': {
    sessionId: string;
    byteLength: number;
    matched: boolean;
    timestamp: string;
  };
  'skia:scene_captured': { canvasId: string; nodeCount: number; timestamp: string };
  'frida:attached': {
    target: string;
    sessionId: string;
    device?: { type: 'local' | 'usb' | 'remote' | 'id'; host?: string; id?: string };
    timestamp: string;
  };
  'frida:spawned': {
    target: string;
    sessionId: string;
    device?: { type: 'local' | 'usb' | 'remote' | 'id'; host?: string; id?: string };
    timestamp: string;
  };
  'adb:device_connected': { serial: string; model: string; timestamp: string };
  'mojo:message_captured': { messageCount: number; timestamp: string };
  'syscall:trace_started': { backend: string; pid?: number; simulate?: boolean; timestamp: string };
  'protocol:pattern_detected': { patternName: string; confidence: number; timestamp: string };
  'protocol:payload_built': { byteLength: number; fieldCount: number; timestamp: string };
  'protocol:payload_mutated': { byteLength: number; mutationCount: number; timestamp: string };
  'protocol:ethernet_frame_built': {
    byteLength: number;
    etherType: string;
    timestamp: string;
  };
  'protocol:arp_built': {
    operation: 'request' | 'reply';
    byteLength: number;
    timestamp: string;
  };
  'protocol:ip_packet_built': {
    version: 'ipv4' | 'ipv6';
    protocol: number;
    byteLength: number;
    timestamp: string;
  };
  'protocol:icmp_echo_built': {
    operation: 'request' | 'reply';
    byteLength: number;
    checksumHex: string;
    timestamp: string;
  };
  'protocol:checksum_applied': {
    checksumHex: string;
    byteLength: number;
    timestamp: string;
  };
  'protocol:pcap_written': {
    path: string;
    packetCount: number;
    byteLength: number;
    timestamp: string;
  };
  'protocol:pcap_read': { path: string; packetCount: number; timestamp: string };
  'protocol:pcapng_written': {
    path: string;
    packetCount: number;
    interfaceCount: number;
    byteLength: number;
    timestamp: string;
  };
  'protocol:pcapng_read': {
    path: string;
    blockCount: number;
    packetCount: number;
    timestamp: string;
  };
  'protocol:dns_dissected': {
    byteLength: number;
    questionCount: number;
    answerCount: number;
    timestamp: string;
  };
  'protocol:http_dissected': {
    byteLength: number;
    kind: 'request' | 'response';
    headerCount: number;
    timestamp: string;
  };
}

interface Subscription {
  handler: EventHandler<unknown>;
  once: boolean;
}

/**
 * Typed pub/sub bus.
 *
 * `TMap` is constrained to `object`, not `Record<string, unknown>`: requiring a
 * string index signature would force every event map to declare one, and a
 * declared index signature collapses `keyof TMap` to `string | number` —
 * turning `emit`/`on` into unchecked calls. See the note on `ServerEventMap`.
 */
export class EventBus<TMap extends object = ServerEventMap> {
  private readonly listeners = new Map<keyof TMap, Subscription[]>();
  private readonly wildcardListeners: Subscription[] = [];

  /**
   * Subscribe to a specific event.
   * Returns an unsubscribe function.
   */
  on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): () => void {
    const subs = this.listeners.get(event) ?? [];
    const subscription: Subscription = { handler: handler as EventHandler<unknown>, once: false };
    subs.push(subscription);
    this.listeners.set(event, subs);

    return () => {
      const list = this.listeners.get(event);
      if (list) {
        const idx = list.indexOf(subscription);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe to a specific event, auto-unsubscribing after the first fire.
   */
  once<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): () => void {
    const subs = this.listeners.get(event) ?? [];
    const subscription: Subscription = { handler: handler as EventHandler<unknown>, once: true };
    subs.push(subscription);
    this.listeners.set(event, subs);

    return () => {
      const list = this.listeners.get(event);
      if (list) {
        const idx = list.indexOf(subscription);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe to all events (wildcard listener).
   */
  onAny(handler: EventHandler<{ event: string; payload: unknown }>): () => void {
    const subscription: Subscription = {
      handler: handler as EventHandler<unknown>,
      once: false,
    };
    this.wildcardListeners.push(subscription);

    return () => {
      const idx = this.wildcardListeners.indexOf(subscription);
      if (idx >= 0) this.wildcardListeners.splice(idx, 1);
    };
  }

  /**
   * Emit an event to all registered listeners.
   *
   * Named listeners run sequentially (preserving ordering semantics).
   * Wildcard listeners run in parallel via Promise.allSettled since they
   * are observability/telemetry side-effects whose ordering does not matter.
   * Errors in one listener never prevent others from running.
   */
  async emit<K extends keyof TMap>(event: K, payload: TMap[K]): Promise<void> {
    const subs = this.listeners.get(event);
    if (subs) {
      const toRemove: number[] = [];
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        if (!sub) continue;
        try {
          await sub.handler(payload);
        } catch {
          // Swallow listener errors to prevent cascading failures
        }
        if (sub.once) toRemove.push(i);
      }
      // Remove once-listeners in reverse order to preserve indices
      for (let i = toRemove.length - 1; i >= 0; i--) {
        subs.splice(toRemove[i]!, 1);
      }
    }

    // Wildcard listeners run in parallel — they are telemetry/observability
    // side-effects whose completion order is irrelevant.
    if (this.wildcardListeners.length > 0) {
      const sessionId = getToolRequestContext()?.sessionId;
      const wildcardPayload =
        sessionId && typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? { ...(payload as Record<string, unknown>), mcpSessionId: sessionId }
          : payload;
      const wildPayload = { event, payload: wildcardPayload };
      const promises = this.wildcardListeners.map((sub) => {
        try {
          return Promise.resolve(sub.handler(wildPayload));
        } catch {
          return Promise.resolve();
        }
      });
      await Promise.allSettled(promises);
    }
  }

  /**
   * Remove all listeners for a specific event, or all listeners if no event specified.
   */
  removeAllListeners(event?: keyof TMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
      this.wildcardListeners.length = 0;
    }
  }

  /**
   * Get the number of listeners for a specific event.
   */
  listenerCount(event: keyof TMap): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

/**
 * Singleton-style factory for the server event bus.
 * Call `createServerEventBus()` once during server init.
 */
export function createServerEventBus(): EventBus<ServerEventMap> {
  return new EventBus<ServerEventMap>();
}

/**
 * Fire-and-forget event publication for hot execution paths.
 *
 * Guarantees:
 * - Tolerates absent/mock buses (duck-typed via `emit` presence) so partial
 *   test contexts and degraded startup modes never crash the caller.
 * - Isolates observer faults: a synchronous throw or a rejected emit promise
 *   is swallowed and must never propagate into tool execution.
 */
export function emitBusEvent<K extends keyof ServerEventMap>(
  bus: EventBus<ServerEventMap> | undefined | null,
  event: K,
  payload: ServerEventMap[K],
): void {
  if (!bus || typeof bus.emit !== 'function') return;
  try {
    Promise.resolve(bus.emit(event, payload)).catch(() => undefined);
  } catch {
    // Observer failures must never break the caller (tool execution path).
  }
}

/**
 * Creates a debounced progress emitter for tool handlers.
 * @param eventBus The server event bus
 * @param progressToken The progress token from args._meta.progressToken
 * @param debounceMs Minimum time between emissions (defaults to 500ms)
 */
export function createProgressDebouncer(
  eventBus: EventBus<ServerEventMap>,
  progressToken: string | number,
  debounceMs = 500,
): (progress: number, total?: number) => void {
  let lastEmit = 0;
  return (progress: number, total?: number) => {
    const now = Date.now();
    if (now - lastEmit >= debounceMs || progress === total) {
      lastEmit = now;
      void eventBus.emit('tool:progress', {
        progressToken,
        progress,
        total,
        timestamp: new Date().toISOString(),
      });
    }
  };
}
