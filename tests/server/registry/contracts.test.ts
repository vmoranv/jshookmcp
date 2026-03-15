import { beforeEach, describe, expect, it } from 'vitest';

describe('registry/contracts', () => {
  beforeEach(() => {
    // Runtime smoke test for a type-only module.
  });

  it('has no runtime exports', async () => {
    const mod = await import('@server/registry/contracts');
    expect(Object.keys(mod)).toEqual([]);
  });
});
