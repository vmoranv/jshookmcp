import { describe, expect, it, vi } from 'vitest';

// Loader rejection path: isolated file so the module-level mock does not
// interfere with the real-catalog tests in skills-extension.test.ts.
vi.mock('@modelcontextprotocol/server/ext/skills/node', () => ({
  loadSkills: vi.fn(async () => {
    throw new Error('storage failure: EACCES');
  }),
}));

import { loadJshookSkills } from '@server/skills/skills-extension';

describe('loadJshookSkills fail-open contract', () => {
  it('resolves null (never rejects) when the loader throws', async () => {
    // Contract: the returned promise is awaited by MCPServer.start(); a
    // rejection would abort server startup. Any loader failure — storage,
    // permission, strict validation — must degrade to null.
    await expect(loadJshookSkills('/some/valid/dir')).resolves.toBeNull();
  });
});
