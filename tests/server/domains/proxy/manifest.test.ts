import { describe, expect, it } from 'vitest';
import manifest from '@server/domains/proxy/manifest';

describe('proxy manifest', () => {
  it('registers proxy rule lifecycle handlers', () => {
    const names = manifest.registrations.map((registration) => registration.tool.name);

    expect(names).toContain('proxy_list_rules');
    expect(names).toContain('proxy_clear_rules');
    expect(names).toContain('proxy_add_rule');
  });
});
