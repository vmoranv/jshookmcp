import { beforeAll, describe, expect, it } from 'vitest';
import { initRegistry } from '@server/registry/index';
import {
  TIER_ORDER,
  getTierIndex,
  getToolsForProfile,
  getToolMinimalTier,
  getProfileDomains,
} from '@server/ToolCatalog';

// Initialize registry once before tests
beforeAll(async () => {
  await initRegistry();
});

describe('Profile Restructuring (PROF-01~04)', () => {
  describe('TIER_ORDER', () => {
    it('includes full at the end', () => {
      const idx = TIER_ORDER.indexOf('full');
      expect(idx).toBeGreaterThan(-1);
      expect(TIER_ORDER[idx - 1]).toBe('workflow');
    });

    it('getTierIndex(workflow) returns correct position (1) and includes search', () => {
      const idx = TIER_ORDER.indexOf('workflow');
      expect(idx).not.toBe(-1);

      // Workflow includes search tier
      expect(getTierIndex('search')).toBe(0);
      expect(getTierIndex('workflow')).toBe(1);

      const searchToolNames = new Set(getToolsForProfile('search').map((t) => t.name));
      const workflowToolNames = new Set(getToolsForProfile('workflow').map((t) => t.name));

      for (const t of searchToolNames) {
        expect(workflowToolNames.has(t)).toBe(true);
      }
      expect(workflowToolNames.size).toBeGreaterThanOrEqual(searchToolNames.size);
    });
  });

  describe('Profile tool sets', () => {
    it('getToolsForProfile(workflow) is superset of getToolsForProfile(search)', () => {
      const searchToolNames = getToolsForProfile('search').map((t) => t.name);
      const workflowToolNames = new Set(getToolsForProfile('workflow').map((t) => t.name));
      for (const name of searchToolNames) {
        expect(workflowToolNames.has(name), `'${name}' in search but not in workflow`).toBe(true);
      }
      expect(workflowToolNames.size).toBeGreaterThanOrEqual(searchToolNames.length);
    });

    it('getToolsForProfile(full) is superset of getToolsForProfile(workflow)', () => {
      const workflowToolNames = getToolsForProfile('workflow').map((t) => t.name);
      const fullToolNames = new Set(getToolsForProfile('full').map((t) => t.name));
      for (const name of workflowToolNames) {
        expect(fullToolNames.has(name), `'${name}' in workflow but not in full`).toBe(true);
      }
      expect(fullToolNames.size).toBeGreaterThanOrEqual(workflowToolNames.length);
    });

    it('search profile returns zero domain tools', () => {
      const tools = getToolsForProfile('search');
      expect(tools).toHaveLength(0);
    });
  });

  describe('hooks domain visibility (PROF-02)', () => {
    it('hooks tools are visible in workflow profile', () => {
      const workflowTools = getToolsForProfile('workflow').map((t) => t.name);
      expect(workflowTools).toContain('ai_hook_inject');
      expect(workflowTools).toContain('hook_preset');
    });

    it('getToolMinimalTier returns workflow for hooks tools after downgrade', () => {
      expect(getToolMinimalTier('hook_preset')).toBe('workflow');
    });
  });

  describe('buildProfileDomains hierarchy', () => {
    it('validates search ⊂ workflow ⊂ full', () => {
      const searchDomains = getProfileDomains('search');
      const workflowDomains = getProfileDomains('workflow');
      const fullDomains = getProfileDomains('full');

      const workflowDomainSet = new Set(workflowDomains);
      const fullDomainSet = new Set(fullDomains);

      // search ⊂ workflow
      for (const d of searchDomains) {
        expect(workflowDomainSet.has(d), `search domain '${d}' missing from workflow`).toBe(true);
      }
      // workflow ⊂ full
      for (const d of workflowDomains) {
        expect(fullDomainSet.has(d), `workflow domain '${d}' missing from full`).toBe(true);
      }
    });
  });
});
