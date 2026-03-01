import { describe, expect, it } from 'vitest';
import {
  allTools,
  getProfileDomains,
  getToolDomain,
  getToolsByDomains,
  getToolsForProfile,
  parseToolDomains,
  TIER_ORDER,
  TIER_DEFAULT_TTL,
  getTierIndex,
} from '../../src/server/ToolCatalog.js';

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

describe('Three-Tier Boost Hierarchy', () => {
  it('TIER_ORDER defines exactly 4 tiers: search → minimal → workflow → full', () => {
    expect(TIER_ORDER).toEqual(['search', 'minimal', 'workflow', 'full']);
  });

  it('getTierIndex returns correct indices for tiered profiles', () => {
    expect(getTierIndex('search')).toBe(0);
    expect(getTierIndex('minimal')).toBe(1);
    expect(getTierIndex('workflow')).toBe(2);
    expect(getTierIndex('full')).toBe(3);
  });

  it('getTierIndex returns -1 for non-tiered profiles', () => {
    expect(getTierIndex('reverse')).toBe(-1);
  });

  it('TIER_DEFAULT_TTL has sane values for each profile', () => {
    expect(TIER_DEFAULT_TTL.search).toBe(0);
    expect(TIER_DEFAULT_TTL.minimal).toBe(0);
    expect(TIER_DEFAULT_TTL.workflow).toBe(60);
    expect(TIER_DEFAULT_TTL.full).toBe(30);
    expect(TIER_DEFAULT_TTL.reverse).toBe(30);
  });

  it('tiers form a strict subset hierarchy: min ⊂ workflow ⊂ full', () => {
    const minDomains = new Set(getProfileDomains('minimal'));
    const workflowDomains = new Set(getProfileDomains('workflow'));
    const fullDomains = new Set(getProfileDomains('full'));

    // min ⊂ workflow
    for (const domain of minDomains) {
      expect(workflowDomains.has(domain)).toBe(true);
    }
    expect(workflowDomains.size).toBeGreaterThan(minDomains.size);

    // workflow ⊂ full
    for (const domain of workflowDomains) {
      expect(fullDomains.has(domain)).toBe(true);
    }
    expect(fullDomains.size).toBeGreaterThan(workflowDomains.size);
  });

  it('tool counts increase with each tier', () => {
    const minTools = getToolsForProfile('minimal');
    const workflowTools = getToolsForProfile('workflow');
    const fullTools = getToolsForProfile('full');

    expect(minTools.length).toBeGreaterThan(0);
    expect(workflowTools.length).toBeGreaterThan(minTools.length);
    expect(fullTools.length).toBeGreaterThan(workflowTools.length);
  });

  it('minimal tier only has browser and maintenance domains', () => {
    const minDomains = getProfileDomains('minimal');
    expect(minDomains).toEqual(expect.arrayContaining(['browser', 'maintenance']));
    expect(minDomains.length).toBe(2);
  });

  it('workflow tier adds core, debugger, network, streaming, encoding, graphql, workflow', () => {
    const workflowDomains = new Set(getProfileDomains('workflow'));
    for (const domain of ['core', 'debugger', 'network', 'streaming', 'encoding', 'graphql', 'workflow']) {
      expect(workflowDomains.has(domain as any)).toBe(true);
    }
  });

  it('full tier adds hooks, process, wasm, antidebug, platform, sourcemap, transform', () => {
    const fullDomains = new Set(getProfileDomains('full'));
    for (const domain of ['hooks', 'process', 'wasm', 'antidebug', 'platform', 'sourcemap', 'transform']) {
      expect(fullDomains.has(domain as any)).toBe(true);
    }
  });
});
