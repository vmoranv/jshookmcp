import type {
  ManagedTargetSessionEntry,
  BrowserTargetInfo,
  TargetFilters,
} from '@modules/browser/BrowserTargetSessionManager.shared';
import { matchesTargetFilters } from '@modules/browser/BrowserTargetSessionManager.shared';

/**
 * Registry for managed CDP target sessions.
 * Extracted from BrowserTargetSessionManager to reduce class complexity.
 */
export class ManagedSessionRegistry {
  private readonly managedSessions = new Map<string, ManagedTargetSessionEntry>();
  private readonly targetIdToSessionId = new Map<string, string>();

  add(sessionId: string, entry: ManagedTargetSessionEntry): void {
    this.managedSessions.set(sessionId, entry);
    this.targetIdToSessionId.set(entry.targetInfo.targetId, sessionId);
  }

  remove(sessionId: string): ManagedTargetSessionEntry | undefined {
    const entry = this.managedSessions.get(sessionId);
    if (entry) {
      this.managedSessions.delete(sessionId);
      const targetId = entry.targetInfo.targetId;
      // The same target can have been re-attached to a newer session; only
      // unmap when this entry still owns the mapping, otherwise the live
      // session becomes unreachable through getByTargetId().
      if (this.targetIdToSessionId.get(targetId) === sessionId) {
        this.targetIdToSessionId.delete(targetId);
      }
    }
    return entry;
  }

  get(sessionId: string): ManagedTargetSessionEntry | undefined {
    return this.managedSessions.get(sessionId);
  }

  getByTargetId(targetId: string): ManagedTargetSessionEntry | undefined {
    const sessionId = this.targetIdToSessionId.get(targetId);
    return sessionId ? this.managedSessions.get(sessionId) : undefined;
  }

  all(): IterableIterator<ManagedTargetSessionEntry> {
    return this.managedSessions.values();
  }

  mapTargetIdToSession(targetId: string, sessionId: string): void {
    this.targetIdToSessionId.set(targetId, sessionId);
  }

  unmapTargetId(targetId: string): void {
    this.targetIdToSessionId.delete(targetId);
  }

  getPriorSessionId(targetId: string): string | undefined {
    return this.targetIdToSessionId.get(targetId);
  }

  findMatchingTargets(
    filters: TargetFilters,
    matchPredicate: (target: BrowserTargetInfo) => boolean,
  ): BrowserTargetInfo[] {
    const results: BrowserTargetInfo[] = [];
    for (const entry of this.managedSessions.values()) {
      if (matchesTargetFilters(entry.targetInfo, filters) && matchPredicate(entry.targetInfo)) {
        results.push(entry.targetInfo);
      }
    }
    return results;
  }

  clear(): void {
    this.managedSessions.clear();
    this.targetIdToSessionId.clear();
  }
}
