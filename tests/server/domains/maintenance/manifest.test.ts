import { describe, expect, it } from 'vitest';
import manifest from '@server/domains/maintenance/manifest';
import { CoreMaintenanceHandlers } from '@server/domains/maintenance/index';

describe('maintenance manifest', () => {
  it('should have valid domain manifest structure', async () => {
    expect(manifest.domain).toBe('maintenance');
    expect(manifest.ensure).toBeInstanceOf(Function);
  });

  it('should correctly ensure singleton handlers in context', async () => {
    const ctx: any = {
      tokenBudget: {},
      unifiedCache: {},
    };
    const h1 = await manifest.ensure(ctx);
    const h2 = await manifest.ensure(ctx);
    expect(h1).toBeInstanceOf(CoreMaintenanceHandlers);
    expect(h1).toBe(h2);
  });
});
