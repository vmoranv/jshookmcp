/**
 * SessionScratchpad — Per-session key/value store for sandbox scripts.
 *
 * Values persist across script executions within the same session.
 * All values are serialized/deserialized via JSON to prevent live
 * object references leaking across sandbox contexts.
 *
 * The store is driven entirely by untrusted sandbox code, so it is bounded:
 * without limits a script could insert unbounded keys/values, and the store
 * (never cleared per session on the hot path) would grow for the process
 * lifetime.
 */

/** Maximum number of sessions retained; the oldest is evicted first. */
const MAX_SESSIONS = 256;
/** Maximum number of keys a single session may hold. */
const MAX_KEYS_PER_SESSION = 256;
/** Maximum serialized size (UTF-16 code units) of one value. */
const MAX_VALUE_CHARS = 64 * 1024;

export class SessionScratchpad {
  private readonly store = new Map<string, Map<string, string>>();

  /**
   * Set a value for a key in a session's scratchpad.
   * Value is JSON-serialized for safety.
   *
   * Throws when the entry would exceed the per-session key or value cap: a
   * silently dropped/oversized write is worse than a visible failure.
   */
  set(sessionId: string, key: string, value: unknown): void {
    let session = this.store.get(sessionId);
    if (!session) {
      // Evict the oldest session when the cap is reached. Re-inserting keeps
      // the Map ordered by recency so an active session is not the victim.
      if (this.store.size >= MAX_SESSIONS) {
        const oldest = this.store.keys().next().value;
        if (oldest !== undefined) this.store.delete(oldest);
      }
      session = new Map();
      this.store.set(sessionId, session);
    } else {
      // Refresh recency on write.
      this.store.delete(sessionId);
      this.store.set(sessionId, session);
    }

    if (!session.has(key) && session.size >= MAX_KEYS_PER_SESSION) {
      throw new Error(
        `SessionScratchpad: session "${sessionId}" exceeds ${MAX_KEYS_PER_SESSION} keys`,
      );
    }
    const serialized = JSON.stringify(value) ?? 'null';
    if (serialized.length > MAX_VALUE_CHARS) {
      throw new Error(
        `SessionScratchpad: value for key "${key}" exceeds ${MAX_VALUE_CHARS} characters`,
      );
    }
    session.set(key, serialized);
  }

  /**
   * Get a value by key from a session's scratchpad.
   * Returns undefined if key doesn't exist.
   */
  get(sessionId: string, key: string): unknown {
    const session = this.store.get(sessionId);
    if (!session) return undefined;
    const raw = session.get(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Get all key/value pairs for a session.
   */
  getAll(sessionId: string): Record<string, unknown> {
    const session = this.store.get(sessionId);
    if (!session) return {};
    const result: Record<string, unknown> = {};
    for (const [k, v] of session) {
      try {
        result[k] = JSON.parse(v);
      } catch {
        result[k] = v;
      }
    }
    return result;
  }

  /**
   * Get all keys for a session.
   */
  keys(sessionId: string): string[] {
    const session = this.store.get(sessionId);
    if (!session) return [];
    return Array.from(session.keys());
  }

  /**
   * Clear all state for a specific session.
   */
  clear(sessionId: string): void {
    this.store.delete(sessionId);
  }

  /**
   * Clear all sessions (server shutdown).
   */
  clearAll(): void {
    this.store.clear();
  }
}
