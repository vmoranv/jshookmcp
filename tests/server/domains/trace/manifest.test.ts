import { describe, expect, it } from 'vitest';
import manifest from '@server/domains/trace/manifest';
import { TraceToolHandlers } from '@server/domains/trace/handlers';

describe('trace manifest', () => {
  it('should have valid domain manifest structure', () => {
    expect(manifest.domain).toBe('trace');
    expect(manifest.ensure).toBeInstanceOf(Function);
  });

  it('should correctly ensure singleton handlers in context', () => {
    const map = new Map<string, any>();
    const ctx: any = {
      getDomainInstance: (key: string) => map.get(key),
      setDomainInstance: (key: string, inst: any) => map.set(key, inst),
    };
    const h1 = manifest.ensure(ctx);
    const h2 = manifest.ensure(ctx);
    expect(h1).toBeInstanceOf(TraceToolHandlers);
    expect(h1).toBe(h2);
  });
});
