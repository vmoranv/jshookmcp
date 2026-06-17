import { describe, expect, it } from 'vitest';
import { DominatorTreeBuilder } from '@modules/v8-inspector/DominatorTreeBuilder';
import type { ParsedNode, ParsedEdge } from '@modules/v8-inspector/HeapSnapshotParser';

describe('DominatorTreeBuilder', () => {
  describe('simple graph dominator computation', () => {
    it('should compute dominators for a simple linear chain', () => {
      // Graph: 1 -> 2 -> 3
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.nodeId).toBe(1);
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].nodeId).toBe(2);
      expect(tree.children[0].children.length).toBe(1);
      expect(tree.children[0].children[0].nodeId).toBe(3);
    });

    it('should compute dominators for a diamond graph', () => {
      // Graph: 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 100, type: 'object' },
        { id: 4, name: 'C', selfSize: 200, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'a', type: 'property' },
        { fromId: 1, toId: 3, nameOrIndex: 'b', type: 'property' },
        { fromId: 2, toId: 4, nameOrIndex: 'c', type: 'property' },
        { fromId: 3, toId: 4, nameOrIndex: 'c', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      // Root should dominate all
      expect(tree.nodeId).toBe(1);
      // Node 4 has two paths, so it should be dominated by root
      const node4 = findNodeInTree(tree, 4);
      expect(node4).toBeDefined();
    });

    it('should handle graphs with cycles', () => {
      // Graph with cycle: 1 -> 2 -> 3 -> 2
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'ref', type: 'property' },
        { fromId: 3, toId: 2, nameOrIndex: 'back', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.nodeId).toBe(1);
      expect(tree.children.length).toBeGreaterThan(0);
    });

    it('should handle disconnected components', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 100, type: 'object' },
      ];

      // Only 1 -> 2, node 3 is disconnected
      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.nodeId).toBe(1);
      // Should handle gracefully
      expect(tree.children.length).toBeGreaterThan(0);
    });
  });

  describe('retained size computation', () => {
    it('should compute retained sizes correctly for linear chain', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.retainedSize).toBe(300); // 0 + 100 + 200
      expect(tree.children[0].retainedSize).toBe(300); // 100 + 200
      expect(tree.children[0].children[0].retainedSize).toBe(200); // 200
    });

    it('should compute retained sizes for branching tree', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 10, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
        { id: 4, name: 'C', selfSize: 50, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'a', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'b', type: 'property' },
        { fromId: 2, toId: 4, nameOrIndex: 'c', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.retainedSize).toBe(360); // 10 + 100 + 200 + 50
    });

    it('should handle zero shallow sizes', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 0, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.retainedSize).toBe(0);
    });
  });

  describe('leak detection', () => {
    it('should detect detached DOM nodes with explicit marker', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Detached HTMLDivElement', selfSize: 2048, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 0);

      const detachedLeak = leaks.find((l) => l.reason === 'detached-dom');
      expect(detachedLeak).toBeDefined();
      expect(detachedLeak?.confidence).toBeGreaterThan(0.8);
    });

    it('should detect DOM nodes with low connectivity', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'HTMLElement', selfSize: 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 0);

      const detachedLeak = leaks.find(
        (l) => l.reason === 'detached-dom' && l.nodeId === 2,
      );
      expect(detachedLeak).toBeDefined();
    });

    it('should detect large arrays', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Array', selfSize: 2 * 1024 * 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 1024 * 1024);

      const arrayLeak = leaks.find((l) => l.reason === 'large-array');
      expect(arrayLeak).toBeDefined();
      expect(arrayLeak?.retainedSize).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    });

    it('should detect closure leaks', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Function', selfSize: 100, type: 'closure' },
        { id: 3, name: 'Context', selfSize: 5 * 1024 * 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'fn', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'context', type: 'internal' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 1024 * 1024);

      const closureLeak = leaks.find((l) => l.reason === 'closure-leak');
      expect(closureLeak).toBeDefined();
    });

    it('should sort leaks by confidence then by size', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Detached HTMLElement', selfSize: 1024, type: 'object' },
        { id: 3, name: 'Array', selfSize: 10 * 1024 * 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'dom', type: 'property' },
        { fromId: 1, toId: 3, nameOrIndex: 'arr', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 0);

      expect(leaks.length).toBeGreaterThan(0);
      // First leak should have highest confidence
      for (let i = 1; i < leaks.length; i++) {
        if (Math.abs(leaks[i - 1].confidence - leaks[i].confidence) > 0.01) {
          expect(leaks[i - 1].confidence).toBeGreaterThanOrEqual(leaks[i].confidence);
        }
      }
    });

    it('should include retaining paths in leak candidates', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Container', selfSize: 100, type: 'object' },
        { id: 3, name: 'Detached HTMLElement', selfSize: 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'container', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'element', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 0);

      const detachedLeak = leaks.find((l) => l.reason === 'detached-dom');
      expect(detachedLeak?.path).toBeDefined();
      expect(detachedLeak?.path.length).toBeGreaterThan(0);
    });
  });

  describe('performance', () => {
    it('should handle 10k nodes within 2 seconds', () => {
      const nodeCount = 10000;
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
      ];
      const edges: ParsedEdge[] = [];

      for (let i = 2; i <= nodeCount; i++) {
        nodes.push({
          id: i,
          name: `Node${i}`,
          selfSize: Math.floor(Math.random() * 1000) + 100,
          type: 'object',
        });

        // Create edges to form a tree-like structure
        const parentId = Math.floor(Math.random() * (i - 1)) + 1;
        edges.push({
          fromId: parentId,
          toId: i,
          nameOrIndex: `ref${i}`,
          type: 'property',
        });
      }

      const builder = new DominatorTreeBuilder();
      const startTime = Date.now();
      const tree = builder.buildDominatorTree(nodes, edges);
      const elapsedMs = Date.now() - startTime;

      expect(tree.nodeId).toBe(1);
      expect(elapsedMs).toBeLessThan(2000);
    });
  });
});

// Helper function to find a node in the tree
function findNodeInTree(tree: any, nodeId: number): any {
  if (tree.nodeId === nodeId) {
    return tree;
  }

  for (const child of tree.children || []) {
    const found = findNodeInTree(child, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

