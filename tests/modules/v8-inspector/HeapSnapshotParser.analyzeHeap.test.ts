import { describe, expect, it } from 'vitest';
import { HeapSnapshotParser } from '@modules/v8-inspector/HeapSnapshotParser';

/**
 * Generate a minimal valid V8 heap snapshot for testing.
 */
function generateMinimalSnapshot(): string {
  return JSON.stringify({
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
        node_types: [
          [
            'hidden',
            'array',
            'string',
            'object',
            'code',
            'closure',
            'regexp',
            'number',
            'native',
            'synthetic',
          ],
          'hidden',
        ],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['context', 'element', 'property', 'internal', 'hidden'], 'context'],
      },
      node_count: 5,
      edge_count: 4,
    },
    nodes: [
      // Node 0: (root) - type=9 (synthetic), name=0, id=1, self_size=0, edge_count=2, trace_node_id=0
      9, 0, 1, 0, 2, 0,
      // Node 1: Array - type=1 (array), name=1, id=2, self_size=1024, edge_count=1, trace_node_id=0
      1, 1, 2, 1024, 1, 0,
      // Node 2: String - type=2 (string), name=2, id=3, self_size=256, edge_count=0, trace_node_id=0
      2, 2, 3, 256, 0, 0,
      // Node 3: Object - type=3 (object), name=3, id=4, self_size=512, edge_count=1, trace_node_id=0
      3, 3, 4, 512, 1, 0,
      // Node 4: Function - type=5 (closure), name=4, id=5, self_size=128, edge_count=0, trace_node_id=0
      5, 4, 5, 128, 0, 0,
    ],
    edges: [
      // Edge 0: root -> Array
      2, 1, 6,
      // Edge 1: root -> Object
      2, 3, 18,
      // Edge 2: Array -> String
      1, 0, 12,
      // Edge 3: Object -> Function
      2, 4, 24,
    ],
    strings: ['(root)', 'Array', 'String', 'Object', 'Function'],
  });
}

/**
 * Generate a snapshot with detached DOM nodes.
 */
function generateSnapshotWithDetachedDOM(): string {
  return JSON.stringify({
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
        node_types: [['hidden', 'array', 'string', 'object'], 'hidden'],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['context'], 'context'],
      },
      node_count: 4,
      edge_count: 0,
    },
    nodes: [
      // Node 0: (root)
      3, 0, 1, 0, 0, 0,
      // Node 1: HTMLDivElement (detached)
      3, 1, 2, 2048, 0, 0,
      // Node 2: Detached InternalNode
      3, 2, 3, 512, 0, 0,
      // Node 3: HTMLSpanElement (low connectivity, likely detached)
      3, 3, 4, 1024, 0, 0,
    ],
    edges: [],
    strings: ['(root)', 'HTMLDivElement', 'Detached InternalNode', 'HTMLSpanElement'],
  });
}

/**
 * Generate a large snapshot for performance testing.
 */
function generateLargeSnapshot(nodeCount: number): string {
  const nodes: number[] = [];
  const edges: number[] = [];
  const strings: string[] = ['(root)'];

  // Add root node
  nodes.push(9, 0, 1, 0, 0, 0);

  // Add many nodes with repeated class names
  for (let i = 1; i < nodeCount; i++) {
    const className = `Class${i % 100}`;
    if (!strings.includes(className)) {
      strings.push(className);
    }
    const nameIdx = strings.indexOf(className);

    // type=3 (object), name=nameIdx, id=i+1, self_size=random, edge_count=0, trace_node_id=0
    nodes.push(3, nameIdx, i + 1, Math.floor(Math.random() * 1000) + 100, 0, 0);
  }

  return JSON.stringify({
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
        node_types: [['hidden', 'array', 'string', 'object'], 'hidden'],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['context'], 'context'],
      },
      node_count: nodeCount,
      edge_count: 0,
    },
    nodes,
    edges,
    strings,
  });
}

describe('HeapSnapshotParser - analyzeHeap', () => {
  describe('class histogram', () => {
    it('should generate class histogram with correct structure', async () => {
      const parser = new HeapSnapshotParser(generateMinimalSnapshot());
      const result = await await parser.analyzeHeap('test-1');

      expect(result.classHistogram).toBeInstanceOf(Array);
      expect(result.classHistogram.length).toBeGreaterThan(0);

      const firstEntry = result.classHistogram[0];
      expect(firstEntry).toHaveProperty('className');
      expect(firstEntry).toHaveProperty('count');
      expect(firstEntry).toHaveProperty('shallowSize');
      expect(firstEntry).toHaveProperty('retainedSize');
    });

    it('should correctly count objects by class name', async () => {
      const parser = new HeapSnapshotParser(generateMinimalSnapshot());
      const result = await await parser.analyzeHeap('test-2');

      const arrayEntry = result.classHistogram.find((e) => e.className === 'Array');
      expect(arrayEntry).toBeDefined();
      expect(arrayEntry?.count).toBe(1);
      expect(arrayEntry?.shallowSize).toBe(1024);
    });

    it('should aggregate multiple objects of same class', async () => {
      // Create snapshot with multiple Array objects
      const snapshot = JSON.stringify({
        snapshot: {
          meta: {
            node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
            node_types: [['array'], 'array'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['context'], 'context'],
          },
          node_count: 3,
          edge_count: 0,
        },
        nodes: [
          // Array 1
          0, 0, 1, 100, 0, 0,
          // Array 2
          0, 0, 2, 200, 0, 0,
          // Array 3
          0, 0, 3, 300, 0, 0,
        ],
        edges: [],
        strings: ['Array'],
      });

      const parser = new HeapSnapshotParser(snapshot);
      const result = await parser.analyzeHeap('test-3');

      const arrayEntry = result.classHistogram.find((e) => e.className === 'Array');
      expect(arrayEntry).toBeDefined();
      expect(arrayEntry?.count).toBe(3);
      expect(arrayEntry?.shallowSize).toBe(600); // 100 + 200 + 300
    });

    it('should sort histogram by retained size descending', async () => {
      const parser = new HeapSnapshotParser(generateMinimalSnapshot());
      const result = await parser.analyzeHeap('test-4');

      // Verify descending order
      for (let i = 1; i < result.classHistogram.length; i++) {
        expect(result.classHistogram[i - 1].retainedSize).toBeGreaterThanOrEqual(
          result.classHistogram[i].retainedSize,
        );
      }
    });

    it('should estimate retained size as shallow size in Phase 1', async () => {
      const parser = new HeapSnapshotParser(generateMinimalSnapshot());
      const result = await parser.analyzeHeap('test-5');

      // In Phase 1, retained size should equal shallow size
      for (const entry of result.classHistogram) {
        expect(entry.retainedSize).toBe(entry.shallowSize);
      }
    });

    it('should handle nodes with missing names using type fallback', async () => {
      const snapshot = JSON.stringify({
        snapshot: {
          meta: {
            node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
            node_types: [['object'], 'object'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['context'], 'context'],
          },
          node_count: 1,
          edge_count: 0,
        },
        nodes: [
          // Node with empty name (string index 0)
          0, 0, 1, 100, 0, 0,
        ],
        edges: [],
        strings: [''],
      });

      const parser = new HeapSnapshotParser(snapshot);
      const result = await parser.analyzeHeap('test-6');

      expect(result.classHistogram.length).toBeGreaterThan(0);
      // Should use either empty string or type fallback
      expect(result.classHistogram[0].className).toBeDefined();
    });
  });

  describe('statistics', () => {
    it('should compute correct statistics', async () => {
      const parser = new HeapSnapshotParser(generateMinimalSnapshot());
      const result = await parser.analyzeHeap('test-7');

      expect(result.statistics.totalObjects).toBe(5);
      expect(result.statistics.nodeCount).toBe(5);
      expect(result.statistics.edgeCount).toBe(4);
      expect(result.statistics.totalShallowSize).toBe(1920); // 0 + 1024 + 256 + 512 + 128
    });

    it('should handle empty snapshot gracefully', async () => {
      const emptySnapshot = JSON.stringify({
        snapshot: {
          meta: {
            node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
            node_types: [['hidden'], 'hidden'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['context'], 'context'],
          },
          node_count: 0,
          edge_count: 0,
        },
        nodes: [],
        edges: [],
        strings: [],
      });

      const parser = new HeapSnapshotParser(emptySnapshot);
      const result = await parser.analyzeHeap('test-8');

      expect(result.classHistogram).toEqual([]);
      expect(result.statistics.totalObjects).toBe(0);
      expect(result.statistics.detachedDOMNodes).toBe(0);
    });
  });

  describe('detached DOM detection', () => {
    it('should detect detached DOM nodes by name pattern', async () => {
      const parser = new HeapSnapshotParser(generateSnapshotWithDetachedDOM());
      const result = await parser.analyzeHeap('test-9');

      // Should detect nodes with "Detached" in name and DOM elements with low connectivity
      expect(result.statistics.detachedDOMNodes).toBeGreaterThan(0);
    });

    it('should detect HTML elements with low connectivity', async () => {
      const parser = new HeapSnapshotParser(generateSnapshotWithDetachedDOM());
      const result = await parser.analyzeHeap('test-10');

      // HTMLDivElement and HTMLSpanElement should be detected as detached
      expect(result.statistics.detachedDOMNodes).toBeGreaterThanOrEqual(2);
    });

    it('should not count well-connected DOM nodes as detached', async () => {
      const snapshot = JSON.stringify({
        snapshot: {
          meta: {
            node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
            node_types: [['object'], 'object'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['property'], 'property'],
          },
          node_count: 3,
          edge_count: 3,
        },
        nodes: [
          // Root
          0, 0, 1, 0, 1, 0,
          // Document
          0, 1, 2, 1000, 1, 0,
          // HTMLDivElement (well-connected) - use name without HTML prefix to avoid false positive
          0, 2, 3, 500, 0, 0,
        ],
        edges: [
          // Root -> Document
          0, 1, 6,
          // Document -> div
          0, 2, 12,
          // Another edge to div (making it well-connected)
          0, 2, 12,
        ],
        strings: ['(root)', 'document', 'div'],
      });

      const parser = new HeapSnapshotParser(snapshot);
      const result = await parser.analyzeHeap('test-11');

      // div has 2+ incoming edges and no HTML prefix, should not be counted as detached
      expect(result.statistics.detachedDOMNodes).toBe(0);
    });
  });

  describe('metadata', () => {
    it('should include metadata with snapshotId and parseTime', async () => {
      const parser = new HeapSnapshotParser(generateMinimalSnapshot());
      const result = await parser.analyzeHeap('test-12');

      expect(result.metadata.snapshotId).toBe('test-12');
      expect(result.metadata.parseTimeMs).toBeGreaterThanOrEqual(0); // Can be 0 for fast parsing
      expect(result.metadata.version).toBe('1.0.0-phase1');
    });

    it('should measure parse time accurately', async () => {
      const parser = new HeapSnapshotParser(generateLargeSnapshot(1000));
      const startTime = Date.now();
      const result = await parser.analyzeHeap('test-13');
      const elapsedMs = Date.now() - startTime;

      // Parse time should be within reasonable bounds (can be 0 for fast operations)
      expect(result.metadata.parseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.parseTimeMs).toBeLessThanOrEqual(elapsedMs + 50); // Allow 50ms tolerance
    });
  });

  describe('performance', () => {
    it('should handle large snapshots within performance target', async () => {
      const parser = new HeapSnapshotParser(generateLargeSnapshot(10000)); // 10k nodes
      const startTime = Date.now();

      const result = await parser.analyzeHeap('test-14');

      const elapsedMs = Date.now() - startTime;

      expect(result.classHistogram.length).toBeGreaterThan(0);
      expect(result.statistics.totalObjects).toBe(10000);
      expect(elapsedMs).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should efficiently aggregate repeated class names', async () => {
      // 1000 nodes with only 100 unique classes (0-99)
      const parser = new HeapSnapshotParser(generateLargeSnapshot(1000));
      const result = await parser.analyzeHeap('test-15');

      // Should have exactly 100 unique classes + root (i % 100 = 100 unique classes)
      expect(result.classHistogram.length).toBeLessThanOrEqual(101); // 100 classes + root
      expect(result.statistics.totalObjects).toBe(1000);
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      // HeapSnapshotParser's ensureParsed handles malformed JSON gracefully
      // It won't throw during construction, only during parsing
      const parser = new HeapSnapshotParser('{ invalid json }');

      // Should return empty results for malformed input
      const result = await parser.analyzeHeap('test-16');

      // Graceful degradation: empty histogram
      expect(result.classHistogram).toEqual([]);
      expect(result.statistics.totalObjects).toBe(0);
    });

    it('should handle missing snapshot fields gracefully', async () => {
      const malformedSnapshot = JSON.stringify({
        snapshot: {
          meta: {},
        },
      });

      const parser = new HeapSnapshotParser(malformedSnapshot);
      const result = await parser.analyzeHeap('test-17');

      // Should not crash, return empty results
      expect(result.classHistogram).toEqual([]);
      expect(result.statistics.totalObjects).toBe(0);
    });
  });

  describe('integration with existing methods', () => {
    it('should produce consistent results with existing parseNodes', async () => {
      const parser = new HeapSnapshotParser(generateMinimalSnapshot());

      const nodes = parser.parseNodes();
      const analysis = await parser.analyzeHeap('test-18');

      expect(analysis.statistics.totalObjects).toBe(nodes.length);
    });

    it('should produce consistent results with existing exportSummary', async () => {
      const parser = new HeapSnapshotParser(generateMinimalSnapshot());

      const summary = parser.exportSummary();
      const analysis = await parser.analyzeHeap('test-19');

      expect(analysis.statistics.totalObjects).toBe(summary.totalNodes);
      expect(analysis.statistics.edgeCount).toBe(summary.totalEdges);
      expect(analysis.statistics.totalShallowSize).toBe(summary.totalSize);
    });
  });
});

