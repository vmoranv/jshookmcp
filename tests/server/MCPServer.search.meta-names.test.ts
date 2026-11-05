import { describe, expect, it } from 'vitest';
import { META_TOOL_NAMES } from '@server/MCPServer.search.meta-names';

/**
 * META_TOOL_DEFINITIONS in MCPServer.search.ts is the authoring source; this
 * leaf module mirrors the names so guard/handler consumers can avoid the
 * barrel. The barrel derives its handler registry from that definition, so
 * iterating META_TOOL_NAMES against getMetaToolHandler is the drift check.
 */
describe('MCPServer.search.meta-names', () => {
  it('matches the names registered by META_TOOL_DEFINITIONS in the barrel', async () => {
    // The barrel derives META_TOOL_NAMES from META_TOOL_DEFINITIONS via the
    // re-export; importing the barrel here is safe from tests.
    const { getMetaToolHandler } = await import('@server/MCPServer.search');
    for (const name of META_TOOL_NAMES) {
      expect(getMetaToolHandler(name), `handler registered for ${name}`).toBeDefined();
    }
  });
});
