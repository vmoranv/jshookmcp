import { beforeEach, describe, expect, it } from 'vitest';

describe('search/ToolSearchEngine barrel', () => {
  beforeEach(() => {
    // Keep a stable test structure.
  });

  it('re-exports the implementation class', async () => {
    const barrel = await import('@server/search/ToolSearchEngine');
    const impl = await import('@server/search/ToolSearchEngineImpl');

    expect(barrel.ToolSearchEngine).toBe(impl.ToolSearchEngine);
  });
});
