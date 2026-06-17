import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { ToolArgs } from '@server/types';
import { clearSnapshotCache, storeSnapshot, getSnapshot } from '@server/domains/v8-inspector/handlers/heap-snapshot';

/**
 * Integration tests for v8_heap_snapshot_analyze with class histogram.
 * Tests the full flow from snapshot capture to analysis.
 */
describe('v8-inspector handlers - heap analysis integration', () => {
  // Mock snapshot data
  const mockSnapshotJson = JSON.stringify({
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
        node_types: [['hidden', 'array', 'string', 'object', 'closure'], 'hidden'],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['context', 'element', 'property'], 'context'],
      },
      node_count: 5,
      edge_count: 2,
    },
    nodes: [
      // Root
      0, 0, 1, 0, 1, 0,
      // Array (1024 bytes)
      1, 1, 2, 1024, 0, 0,
      // String (256 bytes)
      2, 2, 3, 256, 0, 0,
      // Object (512 bytes)
      3, 3, 4, 512, 1, 0,
      // Closure (128 bytes)
      4, 4, 5, 128, 0, 0,
    ],
    edges: [
      // Root -> Array
      0, 1, 6,
      // Object -> Closure
      0, 4, 24,
    ],
    strings: ['(root)', 'Array', 'String', 'Object', 'myFunction'],
  });

  beforeEach(() => {
    // Clear any existing snapshots
    clearSnapshotCache();
  });

  describe('v8_heap_snapshot_analyze', () => {
    it('should analyze snapshot and return class histogram', async () => {
      const { V8InspectorHandlers } = await import(
        '@server/domains/v8-inspector/handlers/impl'
      );

      // Store a mock snapshot
      const snapshotId = 'test-snapshot-1';
      storeSnapshot({
        id: snapshotId,
        chunks: [mockSnapshotJson],
        capturedAt: new Date().toISOString(),
        sizeBytes: Buffer.byteLength(mockSnapshotJson, 'utf8'),
      });

      // Create handler instance
      const mockCtx = { eventBus: { emit: vi.fn() } } as any;
      const mockClient = {} as any;
      const handlers = new V8InspectorHandlers({ ctx: mockCtx, client: mockClient });

      // Call analyze
      const args: ToolArgs = { snapshotId };
      const result = await handlers.handle('v8_heap_snapshot_analyze', args);

      // Verify result structure
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('snapshotId', snapshotId);
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('classHistogram');
      expect(result).toHaveProperty('parseTimeMs');

      // Verify summary
      const summary = (result as any).summary;
      expect(summary.chunkCount).toBe(1);
      expect(summary.totalObjects).toBe(5);
      expect(summary.detachedDOMNodes).toBe(0);

      // Verify histogram
      const histogram = (result as any).classHistogram;
      expect(histogram).toBeInstanceOf(Array);
      expect(histogram.length).toBeGreaterThan(0);

      // Verify histogram entries
      const arrayEntry = histogram.find((e: any) => e.className === 'Array');
      expect(arrayEntry).toBeDefined();
      expect(arrayEntry.count).toBe(1);
      expect(arrayEntry.shallowSize).toBe(1024);
      expect(arrayEntry.retainedSize).toBe(1024); // Phase 1: estimate
    });

    it('should respect topN parameter', async () => {
      const { V8InspectorHandlers } = await import(
        '@server/domains/v8-inspector/handlers/impl'
      );

      // Store a mock snapshot
      const snapshotId = 'test-snapshot-2';
      storeSnapshot({
        id: snapshotId,
        chunks: [mockSnapshotJson],
        capturedAt: new Date().toISOString(),
        sizeBytes: Buffer.byteLength(mockSnapshotJson, 'utf8'),
      });

      const mockCtx = { eventBus: { emit: vi.fn() } } as any;
      const mockClient = {} as any;
      const handlers = new V8InspectorHandlers({ ctx: mockCtx, client: mockClient });

      // Call analyze with topN=2
      const args: ToolArgs = { snapshotId, topN: 2 };
      const result = await handlers.handle('v8_heap_snapshot_analyze', args);

      const histogram = (result as any).classHistogram;
      expect(histogram.length).toBeLessThanOrEqual(2);
    });

    it('should detect detached DOM nodes', async () => {
      const { V8InspectorHandlers } = await import(
        '@server/domains/v8-inspector/handlers/impl'
      );

      // Create snapshot with detached DOM nodes
      const snapshotWithDOM = JSON.stringify({
        snapshot: {
          meta: {
            node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
            node_types: [['object'], 'object'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['property'], 'property'],
          },
          node_count: 3,
          edge_count: 0,
        },
        nodes: [
          // Root
          0, 0, 1, 0, 0, 0,
          // Detached HTMLDivElement
          0, 1, 2, 2048, 0, 0,
          // HTMLSpanElement (low connectivity)
          0, 2, 3, 1024, 0, 0,
        ],
        edges: [],
        strings: ['(root)', 'Detached HTMLDivElement', 'HTMLSpanElement'],
      });

      const snapshotId = 'test-snapshot-3';
      storeSnapshot({
        id: snapshotId,
        chunks: [snapshotWithDOM],
        capturedAt: new Date().toISOString(),
        sizeBytes: Buffer.byteLength(snapshotWithDOM, 'utf8'),
      });

      const mockCtx = { eventBus: { emit: vi.fn() } } as any;
      const mockClient = {} as any;
      const handlers = new V8InspectorHandlers({ ctx: mockCtx, client: mockClient });

      const args: ToolArgs = { snapshotId };
      const result = await handlers.handle('v8_heap_snapshot_analyze', args);

      const summary = (result as any).summary;
      expect(summary.detachedDOMNodes).toBeGreaterThan(0);
    });

    it('should throw error for non-existent snapshot', async () => {
      const { V8InspectorHandlers } = await import(
        '@server/domains/v8-inspector/handlers/impl'
      );

      const mockCtx = { eventBus: { emit: vi.fn() } } as any;
      const mockClient = {} as any;
      const handlers = new V8InspectorHandlers({ ctx: mockCtx, client: mockClient });

      const args: ToolArgs = { snapshotId: 'non-existent' };

      await expect(handlers.handle('v8_heap_snapshot_analyze', args)).rejects.toThrow(
        'Snapshot non-existent not found',
      );
    });

    it('should throw error for missing snapshotId', async () => {
      const { V8InspectorHandlers } = await import(
        '@server/domains/v8-inspector/handlers/impl'
      );

      const mockCtx = { eventBus: { emit: vi.fn() } } as any;
      const mockClient = {} as any;
      const handlers = new V8InspectorHandlers({ ctx: mockCtx, client: mockClient });

      const args: ToolArgs = {};

      await expect(handlers.handle('v8_heap_snapshot_analyze', args)).rejects.toThrow(
        'snapshotId is required',
      );
    });

    it('should handle large snapshots efficiently', async () => {
      const { V8InspectorHandlers } = await import(
        '@server/domains/v8-inspector/handlers/impl'
      );

      // Generate a large snapshot (1000 nodes)
      const nodes: number[] = [];
      const strings: string[] = ['(root)'];

      // Root
      nodes.push(0, 0, 1, 0, 0, 0);

      // 1000 objects with 10 unique class names
      for (let i = 1; i < 1000; i++) {
        const className = `Class${i % 10}`;
        if (!strings.includes(className)) {
          strings.push(className);
        }
        const nameIdx = strings.indexOf(className);
        nodes.push(3, nameIdx, i + 1, 100 + i, 0, 0);
      }

      const largeSnapshot = JSON.stringify({
        snapshot: {
          meta: {
            node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
            node_types: [['hidden', 'array', 'string', 'object'], 'hidden'],
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['context'], 'context'],
          },
          node_count: 1000,
          edge_count: 0,
        },
        nodes,
        edges: [],
        strings,
      });

      const snapshotId = 'test-snapshot-large';
      storeSnapshot({
        id: snapshotId,
        chunks: [largeSnapshot],
        capturedAt: new Date().toISOString(),
        sizeBytes: Buffer.byteLength(largeSnapshot, 'utf8'),
      });

      const mockCtx = { eventBus: { emit: vi.fn() } } as any;
      const mockClient = {} as any;
      const handlers = new V8InspectorHandlers({ ctx: mockCtx, client: mockClient });

      const startTime = Date.now();
      const args: ToolArgs = { snapshotId };
      const result = await handlers.handle('v8_heap_snapshot_analyze', args);
      const elapsedMs = Date.now() - startTime;

      // Should complete quickly
      expect(elapsedMs).toBeLessThan(1000); // Under 1 second for 1000 nodes

      const summary = (result as any).summary;
      expect(summary.totalObjects).toBe(1000);

      const histogram = (result as any).classHistogram;
      expect(histogram.length).toBeGreaterThan(0);
      expect(histogram.length).toBeLessThan(100); // Should aggregate by class name
    });

    it('should return histogram sorted by retained size', async () => {
      const { V8InspectorHandlers } = await import(
        '@server/domains/v8-inspector/handlers/impl'
      );

      const snapshotId = 'test-snapshot-sorted';
      storeSnapshot({
        id: snapshotId,
        chunks: [mockSnapshotJson],
        capturedAt: new Date().toISOString(),
        sizeBytes: Buffer.byteLength(mockSnapshotJson, 'utf8'),
      });

      const mockCtx = { eventBus: { emit: vi.fn() } } as any;
      const mockClient = {} as any;
      const handlers = new V8InspectorHandlers({ ctx: mockCtx, client: mockClient });

      const args: ToolArgs = { snapshotId };
      const result = await handlers.handle('v8_heap_snapshot_analyze', args);

      const histogram = (result as any).classHistogram;

      // Verify descending order by retained size
      for (let i = 1; i < histogram.length; i++) {
        expect(histogram[i - 1].retainedSize).toBeGreaterThanOrEqual(histogram[i].retainedSize);
      }
    });
  });
});
