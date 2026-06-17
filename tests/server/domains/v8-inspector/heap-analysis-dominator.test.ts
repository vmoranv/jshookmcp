import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { V8InspectorHandlers } from '@server/domains/v8-inspector/handlers/impl';
import type { MCPServerContext } from '@server/MCPServer.context';
import { storeSnapshot, clearSnapshotCache } from '@server/domains/v8-inspector/handlers/heap-snapshot';

// Mock snapshot data
function generateMockSnapshot() {
  return JSON.stringify({
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
        node_types: [
          ['hidden', 'array', 'string', 'object', 'code', 'closure', 'synthetic'],
          'hidden',
        ],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['context', 'element', 'property', 'internal'], 'context'],
      },
      node_count: 5,
      edge_count: 4,
    },
    nodes: [
      6, 0, 1, 0, 2, 0, // Root
      1, 1, 2, 1024, 1, 0, // Array
      2, 2, 3, 256, 0, 0, // String
      3, 3, 4, 512, 1, 0, // Object
      4, 4, 5, 128, 0, 0, // Function
    ],
    edges: [
      2, 1, 6, // Root -> Array
      2, 3, 18, // Root -> Object
      1, 0, 12, // Array -> String
      2, 4, 24, // Object -> Function
    ],
    strings: ['(root)', 'Array', 'String', 'Object', 'Function'],
  });
}

describe('V8InspectorHandlers - heap analysis with dominator tree', () => {
  let handlers: V8InspectorHandlers;
  let mockContext: Partial<MCPServerContext>;

  beforeEach(() => {
    clearSnapshotCache();

    mockContext = {
      pageController: undefined,
      eventBus: {
        emit: vi.fn(),
      } as any,
    };

    handlers = new V8InspectorHandlers({
      ctx: mockContext as MCPServerContext,
      client: {} as any,
    });

    // Store test snapshot
    const snapshotData = generateMockSnapshot();
    storeSnapshot({
      id: 'test-snapshot',
      chunks: [snapshotData],
      sizeBytes: snapshotData.length,
      capturedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    clearSnapshotCache();
  });

  describe('v8_heap_snapshot_analyze with dominator tree', () => {
    it('should include dominator tree when requested', async () => {
      const result = await handlers.v8_heap_snapshot_analyze({
        snapshotId: 'test-snapshot',
        includeDominatorTree: true,
        depth: 3,
      });

      expect(result.success).toBe(true);
      expect(result.dominatorTree).toBeDefined();
      expect(result.dominatorTree?.nodeId).toBeDefined();
      expect(result.dominatorTree?.name).toBeDefined();
      expect(result.dominatorTree?.retainedSize).toBeGreaterThanOrEqual(0);
      expect(result.dominatorTree?.children).toBeInstanceOf(Array);
    });

    it('should not include dominator tree by default', async () => {
      const result = await handlers.v8_heap_snapshot_analyze({
        snapshotId: 'test-snapshot',
      });

      expect(result.success).toBe(true);
      expect(result.dominatorTree).toBeUndefined();
    });

    it('should respect depth parameter', async () => {
      const result = await handlers.v8_heap_snapshot_analyze({
        snapshotId: 'test-snapshot',
        includeDominatorTree: true,
        depth: 2,
      });

      expect(result.dominatorTree).toBeDefined();

      // Verify max depth is respected
      const checkDepth = (node: any, currentDepth: number, maxDepth: number): void => {
        if (currentDepth >= maxDepth) {
          expect(node.children).toEqual([]);
        } else if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            checkDepth(child, currentDepth + 1, maxDepth);
          }
        }
      };

      if (result.dominatorTree) {
        checkDepth(result.dominatorTree, 0, 2);
      }
    });
  });

  describe('v8_heap_snapshot_analyze with leak detection', () => {
    it('should include leak candidates when requested', async () => {
      const result = await handlers.v8_heap_snapshot_analyze({
        snapshotId: 'test-snapshot',
        includeLeakDetection: true,
        minLeakSize: 0, // Include all potential leaks
      });

      expect(result.success).toBe(true);
      expect(result.suspectedLeaks).toBeDefined();
      expect(Array.isArray(result.suspectedLeaks)).toBe(true);
    });

    it('should not include leak detection by default', async () => {
      const result = await handlers.v8_heap_snapshot_analyze({
        snapshotId: 'test-snapshot',
      });

      expect(result.success).toBe(true);
      expect(result.suspectedLeaks).toBeUndefined();
    });

    it('should respect minLeakSize parameter', async () => {
      const result = await handlers.v8_heap_snapshot_analyze({
        snapshotId: 'test-snapshot',
        includeLeakDetection: true,
        minLeakSize: 10 * 1024 * 1024, // 10MB
      });

      expect(result.suspectedLeaks).toBeDefined();
      // With our small test snapshot, there should be no leaks above 10MB
      expect(result.suspectedLeaks?.length).toBe(0);
    });
  });

  describe('v8_heap_find_leaks', () => {
    it('should return leak candidates with confidence scores', async () => {
      const result = await handlers.v8_heap_find_leaks({
        snapshotId: 'test-snapshot',
        minRetainedSize: 0,
      });

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe('test-snapshot');
      expect(result.leakCandidates).toBeInstanceOf(Array);
      expect(result.totalCandidates).toBeGreaterThanOrEqual(0);

      if (result.leakCandidates.length > 0) {
        const leak = result.leakCandidates[0];
        expect(leak).toHaveProperty('nodeId');
        expect(leak).toHaveProperty('name');
        expect(leak).toHaveProperty('reason');
        expect(leak).toHaveProperty('confidence');
        expect(leak).toHaveProperty('retainedSize');
        expect(leak).toHaveProperty('path');

        expect(leak.confidence).toBeGreaterThanOrEqual(0);
        expect(leak.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should respect maxResults parameter', async () => {
      const result = await handlers.v8_heap_find_leaks({
        snapshotId: 'test-snapshot',
        minRetainedSize: 0,
        maxResults: 5,
      });

      expect(result.leakCandidates.length).toBeLessThanOrEqual(5);
    });

    it('should sort candidates by confidence', async () => {
      const result = await handlers.v8_heap_find_leaks({
        snapshotId: 'test-snapshot',
        minRetainedSize: 0,
      });

      const candidates = result.leakCandidates;
      for (let i = 1; i < candidates.length; i++) {
        // Allow small confidence differences (sorting by size within same confidence)
        if (Math.abs(candidates[i - 1].confidence - candidates[i].confidence) > 0.01) {
          expect(candidates[i - 1].confidence).toBeGreaterThanOrEqual(candidates[i].confidence);
        }
      }
    });

    it('should include retaining paths', async () => {
      const result = await handlers.v8_heap_find_leaks({
        snapshotId: 'test-snapshot',
        minRetainedSize: 0,
      });

      if (result.leakCandidates.length > 0) {
        const leak = result.leakCandidates[0];
        expect(leak.path).toBeInstanceOf(Array);
        expect(leak.path.length).toBeGreaterThan(0);
      }
    });
  });

  describe('error handling', () => {
    it('should throw when snapshot not found', async () => {
      await expect(
        handlers.v8_heap_snapshot_analyze({
          snapshotId: 'non-existent',
        }),
      ).rejects.toThrow('not found');
    });

    it('should throw when snapshotId is missing', async () => {
      await expect(
        handlers.v8_heap_snapshot_analyze({}),
      ).rejects.toThrow();
    });
  });
});
