import { describe, expect, it } from 'vitest';

import manifest from '@server/domains/sandbox/manifest';
import { SandboxToolHandlers } from '@server/domains/sandbox/handlers';

describe('sandbox manifest', () => {
  it('should have valid domain manifest structure', async () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.version).toBe(1);
    expect(manifest.domain).toBe('sandbox');
    expect(manifest.depKey).toBe('sandboxHandlers');
    expect(manifest.profiles).toContain('full');
    expect(manifest.registrations.length).toBe(1);
  });

  it('should correctly ensure singleton handlers in context', async () => {
    const map = new Map<string, any>();
    const ctx: any = {
      getDomainInstance: (key: string) => map.get(key),
      setDomainInstance: (key: string, inst: any) => map.set(key, inst),
    };
    const h1 = await manifest.ensure(ctx);
    const h2 = await manifest.ensure(ctx);
    expect(h1).toBeInstanceOf(SandboxToolHandlers);
    expect(h1).toBe(h2);
    expect(ctx.getDomainInstance('sandboxHandlers')).toBe(h1);
  });
});
