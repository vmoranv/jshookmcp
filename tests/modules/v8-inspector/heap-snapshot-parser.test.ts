import { describe, it, expect, beforeEach } from 'vitest';
import { HeapSnapshotParser } from '@modules/v8-inspector/HeapSnapshotParser';

/**
 * Build a minimal valid V8 heap snapshot chunk.
 * Format: newline-delimited JSON with node arrays.
 * Line 0: {"snapshot": {"node_types": [...], "edge_types": [...], ...}, "strings": [...]}
 * Line N: [tag, typeIdx, name, id, selfSize] for nodes (tag=0)
 * Line N: [tag, typeIdx, name, toNodeId] for edges (tag=1)
 */
function buildMinimalSnapshot(nodes: Array<[number, string, number, number]>) {
  const header = JSON.stringify({
    snapshot: {
      node_types: [['object', 'string', 'code', 'array']],
      edge_types: ['context', 'element', 'property', 'internal'],
    },
    strings: ['(root)', 'MyObject', 'MyString', 'OtherObject'],
  });
  const nodeLines = nodes.map(([typeIdx, name, id, selfSize]) =>
    JSON.stringify([0, typeIdx, name, id, selfSize]),
  );
  return [header, ...nodeLines].join('\n');
}

describe('HeapSnapshotParser', () => {
  let parser: HeapSnapshotParser;

  beforeEach(() => {
    parser = new HeapSnapshotParser();
  });

  describe('feedChunk', () => {
    it('should parse nodes from snapshot', () => {
      const chunk = buildMinimalSnapshot([
        [0, '(root)', 1, 0],
        [0, 'MyObject', 2, 64],
      ]);
      parser.feedChunk([chunk]);
      expect(parser.nodeCount).toBe(2);
    });

    it('should parse multiple chunks at once', () => {
      const header = JSON.stringify({
        snapshot: {
          node_types: [['object']],
        },
        strings: ['Test'],
      });
      const nodeLine = JSON.stringify([0, 'Test', 1, 32]);
      parser.feedChunk([header + '\n' + nodeLine]);
      expect(parser.nodeCount).toBe(1);
    });

    it('should handle empty chunks gracefully', () => {
      parser.feedChunk(['']);
      expect(parser.nodeCount).toBe(0);
    });

    it('should mark as parsed after feedChunk', () => {
      const chunk = buildMinimalSnapshot([[0, 'Test', 1, 0]]);
      parser.feedChunk([chunk]);
      expect(() => parser.feedChunk([chunk])).toThrow('already parsed');
    });
  });

  describe('getAllNodes', () => {
    it('should return parsed nodes', () => {
      const chunk = buildMinimalSnapshot([
        [0, 'MyObject', 1, 64],
        [1, 'MyString', 2, 16],
      ]);
      parser.feedChunk([chunk]);
      const nodes = parser.getAllNodes();
      expect(nodes).toHaveLength(2);
      expect(nodes[0]?.name).toBe('MyObject');
      expect(nodes[1]?.name).toBe('MyString');
    });
  });

  describe('getNodesByClassName', () => {
    it('should filter nodes by class name', () => {
      const chunk = buildMinimalSnapshot([
        [0, 'MyObject', 1, 64],
        [0, 'OtherObject', 2, 32],
        [0, 'MyObject', 3, 48],
      ]);
      parser.feedChunk([chunk]);
      const nodes = parser.getNodesByClassName('MyObject');
      expect(nodes).toHaveLength(2);
    });

    it('should return empty array for non-existent class', () => {
      const chunk = buildMinimalSnapshot([[0, 'MyObject', 1, 64]]);
      parser.feedChunk([chunk]);
      const nodes = parser.getNodesByClassName('NonExistent');
      expect(nodes).toHaveLength(0);
    });
  });

  describe('getObjectsByType', () => {
    it('should return nodes filtered by type', () => {
      // typeIdx 0 = 'object' per nodeTypeMap
      const chunk = buildMinimalSnapshot([
        [0, 'MyObject', 1, 64],
        [0, 'OtherObject', 2, 32],
      ]);
      parser.feedChunk([chunk]);
      const objects = parser.getObjectsByType('object');
      expect(objects.length).toBe(2);
    });
  });

  describe('buildDominatorTree', () => {
    it('should not throw for empty graph', () => {
      parser.feedChunk([
        JSON.stringify({
          snapshot: { node_types: [['object']] },
          strings: [],
        }),
      ]);
      expect(() => parser.buildDominatorTree()).not.toThrow();
    });

    it('should build tree for single node', () => {
      const chunk = buildMinimalSnapshot([[0, '(root)', 1, 0]]);
      parser.feedChunk([chunk]);
      expect(() => parser.buildDominatorTree()).not.toThrow();
    });
  });

  describe('getTopRetainers', () => {
    it('should return empty array for empty snapshot', () => {
      parser.feedChunk([
        JSON.stringify({
          snapshot: { node_types: [['object']] },
          strings: [],
        }),
      ]);
      const result = parser.getTopRetainers(10);
      expect(result).toEqual([]);
    });

    it('should return limited results', () => {
      const chunk = buildMinimalSnapshot([[0, 'MyObject', 1, 64]]);
      parser.feedChunk([chunk]);
      const result = parser.getTopRetainers(5);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getAllRetainedSizes', () => {
    it('should return array', () => {
      const chunk = buildMinimalSnapshot([[0, 'MyObject', 1, 64]]);
      parser.feedChunk([chunk]);
      const result = parser.getAllRetainedSizes();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
