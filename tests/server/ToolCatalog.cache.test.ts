/**
 * ToolCatalog cache-invalidation tests.
 *
 * Regression for: clearToolGroupsCache() only invalidated `toolGroups`, leaving
 * `toolDomainByName` / `allToolsCache` stale — after ensureDomainLoaded() adds a
 * new domain at runtime, getToolDomain()/allTools kept returning the pre-load
 * view (null domain / missing tool).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/server';

const mocks = vi.hoisted(() => ({
  buildToolGroups: vi.fn<() => Record<string, Tool[]>>(),
  buildToolDomainMap: vi.fn<() => ReadonlyMap<string, string>>(),
  buildAllTools: vi.fn<() => Tool[]>(),
  buildProfileDomains: vi.fn<() => Record<string, string[]>>(),
  getAllDomains: vi.fn<() => ReadonlySet<string>>(),
  getAllRegistrations: vi.fn(),
  getRegistrationByName: vi.fn(),
  onRegistryInvalidate: vi.fn(),
}));

vi.mock('@server/registry/index', () => ({
  buildToolGroups: mocks.buildToolGroups,
  buildToolDomainMap: mocks.buildToolDomainMap,
  buildAllTools: mocks.buildAllTools,
  buildProfileDomains: mocks.buildProfileDomains,
  getAllDomains: mocks.getAllDomains,
  getAllRegistrations: mocks.getAllRegistrations,
  getRegistrationByName: mocks.getRegistrationByName,
  onRegistryInvalidate: mocks.onRegistryInvalidate,
}));

import {
  allTools,
  clearToolGroupsCache,
  getToolDomain,
  getToolsByDomains,
} from '@server/ToolCatalog';

describe('ToolCatalog cache invalidation (runtime domain load)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh pre-load registry view: one domain, one tool.
    mocks.buildToolGroups.mockReturnValue({ browser: [] });
    mocks.buildToolDomainMap.mockReturnValue(new Map([['page_navigate', 'browser']]));
    mocks.buildAllTools.mockReturnValue([{ name: 'page_navigate' } as Tool]);
    mocks.buildProfileDomains.mockReturnValue({ search: [], workflow: [], full: [] });
    mocks.getAllDomains.mockReturnValue(new Set(['browser']));
  });

  it('serves a domain loaded after cache warm-up once the cache is cleared', () => {
    // Warm every cache.
    expect(getToolDomain('page_navigate')).toBe('browser');
    expect(allTools).toHaveLength(1);
    expect(getToolsByDomains(['browser'])).toEqual([]);

    // Simulate ensureDomainLoaded('network') adding a new domain + tool.
    mocks.buildToolGroups.mockReturnValue({ browser: [], network: [] });
    mocks.buildToolDomainMap.mockReturnValue(
      new Map([
        ['page_navigate', 'browser'],
        ['network_enable', 'network'],
      ]),
    );
    mocks.buildAllTools.mockReturnValue([
      { name: 'page_navigate' } as Tool,
      { name: 'network_enable' } as Tool,
    ]);
    mocks.getAllDomains.mockReturnValue(new Set(['browser', 'network']));

    clearToolGroupsCache();

    // The freshly loaded tool must be resolvable through every cached view.
    expect(getToolDomain('network_enable')).toBe('network');
    expect(allTools.map((t) => t.name)).toContain('network_enable');
    expect(allTools).toHaveLength(2);
  });

  it('reflects tool-group growth after cache clear', () => {
    getToolsByDomains(['browser']); // warm toolGroups
    mocks.buildToolGroups.mockReturnValue({ browser: [{ name: 'page_navigate' } as Tool] });

    clearToolGroupsCache();

    expect(getToolsByDomains(['browser']).map((t) => t.name)).toEqual(['page_navigate']);
  });
});
