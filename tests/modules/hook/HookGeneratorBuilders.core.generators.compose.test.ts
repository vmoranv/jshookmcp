import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateHookChain } from '@modules/hook/HookGeneratorBuilders.core.generators.compose';

describe('HookGeneratorBuilders.core.generators.compose', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('concatenates hook scripts and announces the final initialization count', () => {
    const chain = generateHookChain([
      { hookId: 'a', script: 'console.log("a");', instructions: 'one' },
      { hookId: 'b', script: 'console.log("b");', instructions: 'two' },
    ]);

    expect(chain).toContain('console.log("a");');
    expect(chain).toContain('console.log("b");');
    expect(chain.indexOf('console.log("a");')).toBeLessThan(chain.indexOf('console.log("b");'));
    expect(chain).toContain('All 2 hooks initialized');
  });

  it('still returns a summary message when no hooks are provided', () => {
    const chain = generateHookChain([]);

    expect(chain).toBe("console.log('[Hook Chain] All 0 hooks initialized');");
  });
});
