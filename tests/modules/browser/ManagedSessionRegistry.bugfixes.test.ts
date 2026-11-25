import { describe, expect, it } from 'vitest';
import { ManagedSessionRegistry } from '@modules/browser/BrowserTargetSessionManager.ManagedSessionRegistry';
import type { ManagedTargetSessionEntry } from '@modules/browser/BrowserTargetSessionManager.shared';

function createEntry(sessionId: string, targetId: string): ManagedTargetSessionEntry {
  return {
    sessionId,
    session: {} as ManagedTargetSessionEntry['session'],
    targetInfo: { targetId, type: 'page', title: 'target', url: 'about:blank', attached: true },
    networkMonitor: null,
    managedByAutoAttach: true,
    appliedPersistentScripts: new Map(),
  };
}

describe('ManagedSessionRegistry target mapping', () => {
  it('keeps the mapping of a live session when a stale session for the same target is removed', () => {
    const registry = new ManagedSessionRegistry();
    const stale = createEntry('session-old', 'target-1');
    const live = createEntry('session-new', 'target-1');

    registry.add(stale.sessionId, stale);
    registry.add(live.sessionId, live);

    // The target was re-attached, so target-1 now maps to the newer session.
    expect(registry.getByTargetId('target-1')).toBe(live);

    // Removing the stale entry must not erase the live mapping.
    registry.remove(stale.sessionId);

    expect(registry.getByTargetId('target-1')).toBe(live);
    expect(registry.getPriorSessionId('target-1')).toBe('session-new');
    expect(registry.get(stale.sessionId)).toBeUndefined();
  });
});
