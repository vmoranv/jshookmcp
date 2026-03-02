import { describe, it, expect } from 'vitest';
import {
  getTierIndex,
  TIER_ORDER,
  TIER_DEFAULT_TTL,
  getToolsForProfile,
  getToolsByDomains,
  parseToolDomains,
  getToolDomain,
  getProfileDomains,
} from '../../src/server/ToolCatalog.js';

describe('ToolCatalog – tier system', () => {
  it('TIER_ORDER has correct ascending order', () => {
    expect(TIER_ORDER).toEqual(['search', 'minimal', 'workflow', 'full']);
  });

  it('getTierIndex returns correct index for each tier', () => {
    expect(getTierIndex('search')).toBe(0);
    expect(getTierIndex('minimal')).toBe(1);
    expect(getTierIndex('workflow')).toBe(2);
    expect(getTierIndex('full')).toBe(3);
  });

  it('getTierIndex returns -1 for non-tiered profiles', () => {
    expect(getTierIndex('reverse')).toBe(-1);
    expect(getTierIndex('nonexistent' as any)).toBe(-1);
  });

  it('TIER_DEFAULT_TTL has correct values', () => {
    expect(TIER_DEFAULT_TTL.search).toBe(0);
    expect(TIER_DEFAULT_TTL.minimal).toBe(0);
    expect(TIER_DEFAULT_TTL.workflow).toBe(60);
    expect(TIER_DEFAULT_TTL.full).toBe(30);
  });

  it('each tier is a strict superset of the previous tier', () => {
    const searchTools = new Set(getToolsForProfile('search').map(t => t.name));
    const minimalTools = new Set(getToolsForProfile('minimal').map(t => t.name));
    const workflowTools = new Set(getToolsForProfile('workflow').map(t => t.name));
    const fullTools = new Set(getToolsForProfile('full').map(t => t.name));

    // search ⊂ minimal
    for (const name of searchTools) {
      expect(minimalTools.has(name)).toBe(true);
    }
    expect(minimalTools.size).toBeGreaterThan(searchTools.size);

    // minimal ⊂ workflow
    for (const name of minimalTools) {
      expect(workflowTools.has(name)).toBe(true);
    }
    expect(workflowTools.size).toBeGreaterThan(minimalTools.size);

    // workflow ⊂ full
    for (const name of workflowTools) {
      expect(fullTools.has(name)).toBe(true);
    }
    expect(fullTools.size).toBeGreaterThan(workflowTools.size);
  });

  it('getToolsForProfile returns non-empty arrays for all profiles', () => {
    for (const profile of ['search', 'minimal', 'workflow', 'full', 'reverse'] as const) {
      const tools = getToolsForProfile(profile);
      expect(tools.length).toBeGreaterThan(0);
    }
  });

  it('getToolsByDomains returns tools for valid domains', () => {
    const tools = getToolsByDomains(['browser']);
    expect(tools.length).toBeGreaterThan(0);
    // All tools should be from browser domain
    for (const tool of tools) {
      expect(getToolDomain(tool.name)).toBe('browser');
    }
  });

  it('getToolsByDomains deduplicates when same domain is listed twice', () => {
    const tools = getToolsByDomains(['browser', 'browser']);
    const names = tools.map(t => t.name);
    const uniqueNames = [...new Set(names)];
    expect(names.length).toBe(uniqueNames.length);
  });

  it('parseToolDomains parses comma-separated domain string', () => {
    const result = parseToolDomains('browser,debugger,network');
    expect(result).toContain('browser');
    expect(result).toContain('debugger');
    expect(result).toContain('network');
  });

  it('parseToolDomains filters invalid domains', () => {
    const result = parseToolDomains('browser,fakedom,debugger');
    expect(result).toContain('browser');
    expect(result).toContain('debugger');
    expect(result).not.toContain('fakedom');
  });

  it('parseToolDomains returns null for empty input', () => {
    expect(parseToolDomains('')).toBeNull();
    expect(parseToolDomains(undefined)).toBeNull();
    expect(parseToolDomains('  ')).toBeNull();
  });

  it('getToolDomain returns correct domain for known tools', () => {
    expect(getToolDomain('page_navigate')).toBe('browser');
    expect(getToolDomain('debugger_pause')).toBe('debugger');
    expect(getToolDomain('nonexistent_tool')).toBeNull();
  });

  it('getProfileDomains returns correct domains for each profile', () => {
    const searchDomains = getProfileDomains('search');
    expect(searchDomains).toContain('maintenance');

    const minDomains = getProfileDomains('minimal');
    expect(minDomains).toContain('browser');
    expect(minDomains).toContain('maintenance');

    const fullDomains = getProfileDomains('full');
    expect(fullDomains.length).toBeGreaterThan(minDomains.length);
  });
});
