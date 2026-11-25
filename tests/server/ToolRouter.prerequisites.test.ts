import { describe, expect, it, vi } from 'vitest';

/**
 * Regression test: the prerequisite memo must be dropped when the registry
 * reports an invalidation. Lazily activated domains are appended to the
 * manifests array after the first `getEffectivePrerequisites()` call, so an
 * un-invalidated cache served stale (missing) prerequisites for the rest of the
 * session.
 */
const state = vi.hoisted(() => {
  const listeners: Array<() => void> = [];
  const manifests: Array<Record<string, unknown>> = [];
  return {
    listeners,
    manifests,
    getLoadedManifests: vi.fn(() => manifests),
    onRegistryInvalidate: vi.fn((listener: () => void) => {
      listeners.push(listener);
    }),
  };
});

vi.mock('@server/registry/state', () => ({
  getLoadedManifests: state.getLoadedManifests,
  onRegistryInvalidate: state.onRegistryInvalidate,
}));

import { getEffectivePrerequisites } from '@server/ToolRouter.prerequisites';

function manifest(domain: string, toolName: string) {
  return {
    kind: 'domain-manifest',
    version: 1,
    domain,
    depKey: `${domain}Handlers`,
    profiles: ['workflow', 'full'],
    registrations: [],
    ensure: () => ({}),
    prerequisites: {
      [toolName]: [{ condition: 'Page must be navigated', fix: 'Call page_navigate first' }],
    },
  };
}

describe('getEffectivePrerequisites — registry invalidation', () => {
  it('picks up prerequisites from a manifest appended after the cache was built', () => {
    state.manifests.push(manifest('first-domain', 'first_tool'));

    expect(getEffectivePrerequisites().first_tool).toBeDefined();

    // A lazily activated domain appends to the manifests array.
    state.manifests.push(manifest('second-domain', 'second_tool'));

    // Still cached until the registry signals invalidation.
    expect(getEffectivePrerequisites().second_tool).toBeUndefined();

    // Registered at module load (clearMocks in the vitest config wipes the
    // call history, so assert on the captured listener list).
    expect(state.listeners.length).toBeGreaterThan(0);
    for (const listener of state.listeners) listener();

    expect(getEffectivePrerequisites().second_tool).toBeDefined();
    expect(getEffectivePrerequisites().first_tool).toBeDefined();
  });
});
