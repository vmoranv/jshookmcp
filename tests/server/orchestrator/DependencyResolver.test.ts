import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyResolver } from '@server/orchestrator/DependencyResolver';

function makeManifest(
  domain: string,
  toolDeps: Array<{ from: string; to: string; relation: string }>,
) {
  return {
    domain,
    depKey: `${domain}Handlers`,
    kind: 'domain-manifest' as const,
    version: 1,
    profiles: ['workflow', 'full'] as const,
    registrations: [] as never[],
    toolDependencies: toolDeps,
    prerequisites: {} as Record<string, Array<{condition: string; fix: string}>>,
    ensure: () => ({}),
    workflowRule: undefined,
  };
}

describe('DependencyResolver', () => {
  let resolver: DependencyResolver;

  beforeEach(() => {
    resolver = new DependencyResolver();
  });

  describe('buildFromManifests', () => {
    it('should build edges from toolDependencies', () => {
      const manifests = [
        makeManifest('v8-inspector', [
          { from: 'v8_heap_snapshot_capture', to: 'browser_attach', relation: 'requires' },
        ]),
      ];
      resolver.buildFromManifests(manifests);
      const edges = resolver.getEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0]?.from).toBe('v8_heap_snapshot_capture');
      expect(edges[0]?.to).toBe('browser_attach');
      expect(edges[0]?.weight).toBe(1.0);
    });

    it('should handle manifests without toolDependencies', () => {
      const manifests = [makeManifest('empty', [])];
      resolver.buildFromManifests(manifests);
      expect(resolver.getEdges()).toHaveLength(0);
    });
  });

  describe('topologicalSort', () => {
    it('should return valid execution order', () => {
      const manifests = [
        makeManifest('domainA', [
          { from: 'toolA', to: 'toolB', relation: 'precedes' },
        ]),
      ];
      resolver.buildFromManifests(manifests);
      const order = resolver.topologicalSort();
      expect(order).not.toBeNull();
      // toolA must come before toolB
      expect(order).toContain('toolA');
      expect(order).toContain('toolB');
    });

    it('should return null for cyclic dependencies', () => {
      const manifests = [
        makeManifest('cycle', [
          { from: 'toolA', to: 'toolB', relation: 'requires' },
          { from: 'toolB', to: 'toolA', relation: 'requires' },
        ]),
      ];
      resolver.buildFromManifests(manifests);
      const order = resolver.topologicalSort();
      expect(order).toBeNull();
    });

    it('should handle empty graph', () => {
      resolver.buildFromManifests([]);
      const order = resolver.topologicalSort();
      expect(order).toEqual([]);
    });
  });

  describe('detectCycles', () => {
    it('should detect a cycle', () => {
      const manifests = [
        makeManifest('cycle', [
          { from: 'A', to: 'B', relation: 'requires' },
          { from: 'B', to: 'A', relation: 'requires' },
        ]),
      ];
      resolver.buildFromManifests(manifests);
      const cycles = resolver.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should return empty for acyclic graph', () => {
      const manifests = [
        makeManifest('acyclic', [
          { from: 'A', to: 'B', relation: 'suggests' },
          { from: 'B', to: 'C', relation: 'suggests' },
        ]),
      ];
      resolver.buildFromManifests(manifests);
      const cycles = resolver.detectCycles();
      expect(cycles).toEqual([]);
    });
  });

  describe('predecessor/successor queries', () => {
    it('should get predecessors', () => {
      const manifests = [
        makeManifest('domain', [
          { from: 'A', to: 'B', relation: 'precedes' },
          { from: 'C', to: 'B', relation: 'precedes' },
        ]),
      ];
      resolver.buildFromManifests(manifests);
      const preds = resolver.getPredecessors('B');
      expect(preds).toContain('A');
      expect(preds).toContain('C');
    });

    it('should get successors', () => {
      const manifests = [
        makeManifest('domain', [
          { from: 'A', to: 'B', relation: 'precedes' },
        ]),
      ];
      resolver.buildFromManifests(manifests);
      const succs = resolver.getSuccessors('A');
      expect(succs).toContain('B');
    });

    it('should return empty for unknown tool', () => {
      resolver.buildFromManifests([]);
      expect(resolver.getPredecessors('unknown')).toEqual([]);
      expect(resolver.getSuccessors('unknown')).toEqual([]);
    });
  });
});
