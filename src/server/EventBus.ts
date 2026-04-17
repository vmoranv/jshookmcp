/**
 * EventBus — type-safe publish/subscribe event bus for decoupling MCPServer internals.
 *
 * Replaces direct domain-to-server coupling with a central event dispatch.
 * Supports async listeners, one-time subscriptions, and wildcard listeners.
 */

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

/** Core event map — extend via module augmentation for domain-specific events. */
export interface ServerEventMap {
  [key: string]: unknown;
  'tool:activated': { toolName: string; domain: string; timestamp: string };
  'tool:deactivated': { toolName: string; domain: string; timestamp: string };
  'tool:called': { toolName: string; domain: string | null; timestamp: string; success: boolean };
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
  'evidence:updated': { timestamp: string; reason: string };
  'network:intercept_started': { interceptType: string; timestamp: string };
  'v8:heap_captured': { snapshotId: string; sizeBytes: number; timestamp: string };
  'tls:keylog_started': { filePath: string; timestamp: string };
  'skia:scene_captured': { canvasId: string; nodeCount: number; timestamp: string };
  'frida:attached': { target: string; sessionId: string; timestamp: string };
  'adb:device_connected': { serial: string; model: string; timestamp: string };
  'mojo:message_captured': { messageCount: number; timestamp: string };
  'syscall:trace_started': { backend: string; pid?: number; timestamp: string };
  'protocol:pattern_detected': { patternName: string; confidence: number; timestamp: string };
}

interface Subscription {
  handler: EventHandler<unknown>;
  once: boolean;
}

export class EventBus<TMap extends Record<string, unknown> = ServerEventMap> {
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
   * Listeners run in registration order. Errors in one listener don't prevent others.
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

    // Wildcard listeners
    for (const sub of this.wildcardListeners) {
      try {
        await sub.handler({ event, payload });
      } catch {
        // Swallow
      }
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
