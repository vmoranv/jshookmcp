/**
 * SessionScratchpad — Per-session key/value store for sandbox scripts.
 *
 * Values persist across script executions within the same session.
 * All values are serialized/deserialized via JSON to prevent live
 * object references leaking across sandbox contexts.
 */

export class SessionScratchpad {
  private readonly store = new Map<string, Map<string, string>>();

  /**
   * Set a value for a key in a session's scratchpad.
   * Value is JSON-serialized for safety.
   */
  set(sessionId: string, key: string, value: unknown): void {
    let session = this.store.get(sessionId);
    if (!session) {
      session = new Map();
      this.store.set(sessionId, session);
    }
    session.set(key, JSON.stringify(value));
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
