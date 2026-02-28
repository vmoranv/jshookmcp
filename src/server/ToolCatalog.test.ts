import { describe, expect, it } from 'vitest';
import {
  allTools,
  getProfileDomains,
  getToolDomain,
  getToolsByDomains,
  getToolsForProfile,
  parseToolDomains,
} from './ToolCatalog.js';

describe('ToolCatalog', () => {
  it('parseToolDomains returns null for empty input', () => {
    expect(parseToolDomains(undefined)).toBeNull();
    expect(parseToolDomains('   ')).toBeNull();
  });

  it('parseToolDomains filters invalid values and deduplicates', () => {
    const parsed = parseToolDomains('browser,network,invalid,browser,NETWORK');
    expect(parsed).toEqual(['browser', 'network']);
  });

  it('getToolsByDomains returns deduplicated tool definitions', () => {
    const tools = getToolsByDomains(['browser', 'browser']);
    const names = tools.map((tool) => tool.name);
    const unique = new Set(names);

    expect(names.length).toBe(unique.size);
    expect(names.length).toBeGreaterThan(0);
  });

  it('getToolsForProfile(minimal) returns a non-empty subset of all tools', () => {
    const minimal = getToolsForProfile('minimal');
    expect(minimal.length).toBeGreaterThan(0);
    expect(minimal.length).toBeLessThanOrEqual(allTools.length);
  });

  it('getToolDomain resolves known tools and returns null for unknown names', () => {
    expect(getToolDomain('page_navigate')).toBe('browser');
    expect(getToolDomain('network_get_requests')).toBe('network');
    expect(getToolDomain('non_existent_tool_name')).toBeNull();
  });

  it('getProfileDomains returns expected domain sets', () => {
    expect(getProfileDomains('workflow')).toContain('workflow');
    expect(getProfileDomains('full')).toContain('transform');
    expect(getProfileDomains('reverse')).toContain('antidebug');
  });
});

