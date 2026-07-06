import { describe, expect, it } from 'vitest';
import { PROXY_TOOLS } from '@server/domains/proxy/definitions';

describe('proxy domain definitions', () => {
  it('declares rule lifecycle tools', () => {
    const names = PROXY_TOOLS.map((tool) => tool.name);

    expect(names).toContain('proxy_add_rule');
    expect(names).toContain('proxy_list_rules');
    expect(names).toContain('proxy_clear_rules');
  });

  it('marks list_rules as read-only and clear_rules as resettable', () => {
    const listRules = PROXY_TOOLS.find((tool) => tool.name === 'proxy_list_rules');
    const clearRules = PROXY_TOOLS.find((tool) => tool.name === 'proxy_clear_rules');

    expect(listRules?.annotations?.readOnlyHint).toBe(true);
    expect(clearRules?.annotations?.destructiveHint).toBe(true);
    expect(clearRules?.annotations?.idempotentHint).toBe(true);
  });
});
