import { describe, expect, it } from 'vitest';
import {
  allTools,
  getProfileDomains,
  getToolDomain,
  getToolsByDomains,
  getToolsForProfile,
  parseToolDomains,
  TIER_ORDER,
  getTierIndex,
  getToolMinimalTier,
  getMinSatisfyingTier,
} from '@server/ToolCatalog';

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

  it('getToolsForProfile(search) returns a non-empty subset of all tools', () => {
    const search = getToolsForProfile('search');
    expect(search.length).toBeGreaterThan(0);
    expect(search.length).toBeLessThanOrEqual(allTools.length);
  });

  it('getToolDomain resolves known tools and returns null for unknown names', () => {
    expect(getToolDomain('page_navigate')).toBe('browser');
    expect(getToolDomain('network_get_requests')).toBe('network');
    expect(getToolDomain('non_existent_tool_name')).toBeNull();
  });

  it('representative tools resolve to expected domains', () => {
    expect(getToolDomain('webpack_enumerate')).toBe('core');
    expect(getToolDomain('source_map_extract')).toBe('core');
    expect(getToolDomain('framework_state_extract')).toBe('browser');
    expect(getToolDomain('indexeddb_dump')).toBe('browser');
    expect(getToolDomain('electron_attach')).toBe('process');
  });

  it('getProfileDomains returns expected domain sets', () => {
    expect(getProfileDomains('workflow')).toContain('workflow');
    expect(getProfileDomains('full')).toContain('transform');
  });

  it('unknown domains are ignored by discovery and profile domain lists', () => {
    expect(parseToolDomains('obsolete_domain')).toBeNull();
    expect(parseToolDomains('browser,obsolete_domain')).toEqual(['browser']);
    expect(getToolsByDomains(['obsolete_domain' as any])).toEqual([]);

    for (const profile of ['search', 'workflow', 'full'] as const) {
      expect(getProfileDomains(profile)).not.toContain('obsolete_domain' as any);
    }
  });

  it('externalized bridge tools are not present in built-in ToolCatalog', () => {
    const migratedBridgeTools = [
      'native_bridge_status',
      'ghidra_bridge',
      'ida_bridge',
      'native_symbol_sync',
      'frida_bridge',
      'jadx_bridge',
    ] as const;

    const allNames = new Set(allTools.map((tool) => tool.name));
    for (const toolName of migratedBridgeTools) {
      expect(allNames.has(toolName)).toBe(false);
      expect(getToolDomain(toolName)).toBeNull();
    }
  });
});

describe('Three-Tier Boost Hierarchy', () => {
  it('TIER_ORDER defines exactly 3 tiers: search → workflow → full', () => {
    expect(TIER_ORDER).toEqual(['search', 'workflow', 'full']);
  });

  it('getTierIndex returns correct indices for tiered profiles', () => {
    expect(getTierIndex('search')).toBe(0);
    expect(getTierIndex('workflow')).toBe(1);
    expect(getTierIndex('full')).toBe(2);
  });

  it('getTierIndex returns -1 for unknown profiles', () => {
    expect(getTierIndex('nonexistent' as any)).toBe(-1);
  });

  it('tiers form a strict subset hierarchy: search ⊂ workflow ⊂ full', () => {
    const searchDomains = new Set(getProfileDomains('search'));
    const workflowDomains = new Set(getProfileDomains('workflow'));
    const fullDomains = new Set(getProfileDomains('full'));

    // search ⊂ workflow
    for (const domain of searchDomains) {
      expect(workflowDomains.has(domain)).toBe(true);
    }
    expect(workflowDomains.size).toBeGreaterThan(searchDomains.size);

    // workflow ⊂ full
    for (const domain of workflowDomains) {
      expect(fullDomains.has(domain)).toBe(true);
    }
    expect(fullDomains.size).toBeGreaterThan(workflowDomains.size);
  });

  it('tool counts increase with each tier', () => {
    const searchTools = getToolsForProfile('search');
    const workflowTools = getToolsForProfile('workflow');
    const fullTools = getToolsForProfile('full');

    expect(searchTools.length).toBeGreaterThan(0);
    expect(workflowTools.length).toBeGreaterThan(searchTools.length);
    expect(fullTools.length).toBeGreaterThan(workflowTools.length);
  });

  it('search tier only has the maintenance domain', () => {
    const searchDomains = getProfileDomains('search');
    expect(searchDomains).toEqual(['maintenance']);
  });

  it('getToolMinimalTier returns correct tier for known tools', () => {
    // maintenance domain is in search tier
    expect(getToolMinimalTier('get_token_budget_stats')).toBe('search');

    // browser domain is in workflow tier
    expect(getToolMinimalTier('page_navigate')).toBe('workflow');

    // process domain is in full tier
    expect(getToolMinimalTier('electron_attach')).toBe('full');
  });

  it('getToolMinimalTier returns null for unknown tools', () => {
    expect(getToolMinimalTier('non_existent_tool')).toBeNull();
  });

  it('getMinSatisfyingTier returns null for empty array', () => {
    expect(getMinSatisfyingTier([])).toBeNull();
  });

  it('getMinSatisfyingTier returns minimal tier covering all tools', () => {
    // All search-tier tools -> search
    expect(getMinSatisfyingTier(['get_token_budget_stats'])).toBe('search');

    // Mix of search and workflow -> workflow
    expect(getMinSatisfyingTier(['get_token_budget_stats', 'page_navigate'])).toBe('workflow');

    // Mix of search, workflow, and full -> full
    expect(
      getMinSatisfyingTier(['get_token_budget_stats', 'page_navigate', 'electron_attach'])
    ).toBe('full');
  });

  it('getMinSatisfyingTier ignores unknown tools', () => {
    expect(getMinSatisfyingTier(['get_token_budget_stats', 'unknown_tool'])).toBe('search');
    expect(getMinSatisfyingTier(['unknown_tool', 'another_unknown'])).toBeNull();
  });

  it('workflow tier adds core, debugger, network, streaming, encoding, graphql, workflow', () => {
    const workflowDomains = new Set(getProfileDomains('workflow'));
    for (const domain of [
      'core',
      'debugger',
      'network',
      'streaming',
      'encoding',
      'graphql',
      'workflow',
    ]) {
      expect(workflowDomains.has(domain as any)).toBe(true);
    }
  });

  it('full tier adds hooks, process, wasm, antidebug, platform, sourcemap, transform', () => {
    const fullDomains = new Set(getProfileDomains('full'));
    for (const domain of [
      'hooks',
      'process',
      'wasm',
      'antidebug',
      'platform',
      'sourcemap',
      'transform',
    ]) {
      expect(fullDomains.has(domain as any)).toBe(true);
    }
  });
});
