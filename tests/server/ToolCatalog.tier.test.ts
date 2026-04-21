import { describe, it, expect } from 'vitest';
import {
  getTierIndex,
  TIER_ORDER,
  getToolsForProfile,
  getToolsByDomains,
  parseToolDomains,
  getToolDomain,
  getProfileDomains,
} from '@server/ToolCatalog';
import { initRegistry } from '@server/registry/index';

await initRegistry();

describe('ToolCatalog – tier system', () => {
  it('TIER_ORDER has correct ascending order', () => {
    expect(TIER_ORDER).toEqual(['search', 'workflow', 'full']);
  });

  it('getTierIndex returns correct index for each tier', () => {
    expect(getTierIndex('search')).toBe(0);
    expect(getTierIndex('workflow')).toBe(1);
    expect(getTierIndex('full')).toBe(2);
  });

  it('getTierIndex returns -1 for non-tiered profiles', () => {
    expect(getTierIndex('nonexistent' as any)).toBe(-1);
  });

  it('each tier is a strict superset of the previous tier', () => {
    const searchTools = new Set(getToolsForProfile('search').map((t) => t.name));
    const workflowTools = new Set(getToolsForProfile('workflow').map((t) => t.name));
    const fullTools = new Set(getToolsForProfile('full').map((t) => t.name));

    // search ⊂ workflow
    for (const name of searchTools) {
      expect(workflowTools.has(name)).toBe(true);
    }
    expect(workflowTools.size).toBeGreaterThan(searchTools.size);

    // workflow ⊂ full
    for (const name of workflowTools) {
      expect(fullTools.has(name)).toBe(true);
    }
    expect(fullTools.size).toBeGreaterThan(workflowTools.size);
  });

  it('getToolsForProfile returns valid arrays for all profiles', () => {
    for (const profile of ['search', 'workflow', 'full'] as const) {
      const tools = getToolsForProfile(profile);
      if (profile === 'search') {
        expect(tools.length).toBeGreaterThanOrEqual(0);
      } else {
        expect(tools.length).toBeGreaterThan(0);
      }
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
    const names = tools.map((t) => t.name);
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

  it('representative tools resolve to expected domains', () => {
    expect(getToolDomain('webpack_enumerate')).toBe('core');
    expect(getToolDomain('framework_state_extract')).toBe('browser');
    expect(getToolDomain('indexeddb_dump')).toBe('browser');
    expect(getToolDomain('electron_attach')).toBe('process');
  });

  it('getProfileDomains returns correct domains for each profile', () => {
    const searchDomains = getProfileDomains('search');
    expect(searchDomains).toEqual([]);

    const workflowDomains = getProfileDomains('workflow');
    expect(workflowDomains).toContain('browser');
    expect(workflowDomains).toContain('maintenance');

    const fullDomains = getProfileDomains('full');
    expect(fullDomains.length).toBeGreaterThan(workflowDomains.length);
  });

  it('unknown domains are ignored in parsing and profile outputs', () => {
    expect(parseToolDomains('obsolete_domain')).toBeNull();
    expect(parseToolDomains('maintenance,obsolete_domain')).toEqual(['maintenance']);

    for (const profile of ['search', 'workflow', 'full'] as const) {
      expect(getProfileDomains(profile)).not.toContain('obsolete_domain' as any);
    }
  });
});
