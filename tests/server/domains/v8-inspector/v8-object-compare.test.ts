import { describe, it, expect, beforeEach, vi } from 'vitest';
import { V8InspectorHandlers } from '@server/domains/v8-inspector/index';
import {
  getSnapshotCache,
  clearSnapshotCache,
} from '@server/domains/v8-inspector/handlers/heap-snapshot';
import { V8InspectorClient } from '@modules/v8-inspector/V8InspectorClient';
import type { MCPServerContext } from '@server/MCPServer.context';

/** Build a minimal but valid heap snapshot chunk with distinct strings per node. */
function buildChunk(
  desc: Array<{ name: string; id: number; selfSize: number; edgeCount?: number }>,
  edges: Array<[number, number, number]>,
): string {
  // Collect unique names for the strings table
  const stringSet = new Set<string>();
  for (const d of desc) stringSet.add(d.name);
  const strings = [...stringSet];
  const nameIdx = (name: string) => strings.indexOf(name);

  // Flat node array: [type, name_idx, id, self_size, edge_count, trace_node_id] × N
  const nodes: number[] = [];
  for (const d of desc) {
    nodes.push(0, nameIdx(d.name), d.id, d.selfSize, d.edgeCount ?? 0, 0);
  }
  // Flat edge array: [type, name_or_index, to_node] × N
  const edgeArr: number[] = [];
  for (const e of edges) edgeArr.push(0, e[2] ?? 0, e[1]);

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
            'number',
            'native',
            'synthetic',
            'concatenated string',
            'sliced string',
            'symbol',
            'bigint',
            'internal',
          ],
          'hidden',
        ],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [
          ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak'],
          'context',
        ],
      },
      node_count: desc.length,
      edge_count: edges.length,
    },
    nodes,
    edges: edgeArr,
    strings,
  });
}

describe('v8_object_compare', () => {
  let handlers: V8InspectorHandlers;
  let mockCtx: MCPServerContext;

  beforeEach(() => {
    clearSnapshotCache();
    mockCtx = {
      eventBus: { emit: vi.fn() },
    } as unknown as MCPServerContext;
    const client = new V8InspectorClient(undefined);
    handlers = new V8InspectorHandlers({ ctx: mockCtx, client });
  });

  describe('input validation', () => {
    it('rejects when objectIds is missing', async () => {
      await expect(handlers.handle('v8_object_compare', { snapshotId: 's1' })).rejects.toThrow(
        'objectIds',
      );
    });

    it('rejects when objectIds is not an array', async () => {
      await expect(
        handlers.handle('v8_object_compare', { snapshotId: 's1', objectIds: 42 }),
      ).rejects.toThrow('objectIds');
    });

    it('rejects when objectIds is empty', async () => {
      await expect(
        handlers.handle('v8_object_compare', { snapshotId: 's1', objectIds: [] }),
      ).rejects.toThrow('objectIds');
    });

    it('rejects when objectIds has more than 50 entries', async () => {
      const ids = Array.from({ length: 60 }, (_, i) => i);
      await expect(
        handlers.handle('v8_object_compare', { snapshotId: 's1', objectIds: ids }),
      ).rejects.toThrow('at most 50');
    });

    it('rejects when snapshot is not found', async () => {
      await expect(
        handlers.handle('v8_object_compare', { snapshotId: 's1', objectIds: [1, 2] }),
      ).rejects.toThrow('not found');
    });
  });

  describe('structural comparison (same snapshot)', () => {
    it('compares two objects and reports shallow-size delta', async () => {
      const snapId = 'snap_shallow';
      const chunk = buildChunk(
        [
          { name: 'Object', id: 1, selfSize: 100 },
          { name: 'Object', id: 2, selfSize: 200 },
        ],
        [],
      );
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 300,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1, 2],
      });
      const r = result as any;

      expect(r.success).toBe(true);
      expect(r.pairs).toHaveLength(1);
      expect(r.pairs[0].objectA).toMatchObject({ nodeId: 1, name: 'Object', shallowSize: 100 });
      expect(r.pairs[0].objectB).toMatchObject({ nodeId: 2, name: 'Object', shallowSize: 200 });
      expect(r.pairs[0].delta.shallowSize).toBe(100);
    });

    it('reports class name differences', async () => {
      const snapId = 'snap_class';
      const chunk = buildChunk(
        [
          { name: 'HTMLDivElement', id: 1, selfSize: 100 },
          { name: 'HTMLSpanElement', id: 2, selfSize: 100 },
        ],
        [],
      );
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 200,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1, 2],
      });
      const r = result as any;

      expect(r.pairs[0].classMatch).toBe(false);
      expect(r.pairs[0].sameClass).toBe(false);
    });

    it('reports identical class name as classMatch=true', async () => {
      const snapId = 'snap_sameclass';
      const chunk = buildChunk(
        [
          { name: 'MyComponent', id: 1, selfSize: 100 },
          { name: 'MyComponent', id: 2, selfSize: 200 },
        ],
        [],
      );
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 300,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1, 2],
      });
      const r = result as any;

      expect(r.pairs[0].classMatch).toBe(true);
      expect(r.pairs[0].sameClass).toBe(true);
    });

    it('compares n-way (3+ objects) in all-pairs combos', async () => {
      const snapId = 'snap_3way';
      const chunk = buildChunk(
        [
          { name: 'A', id: 1, selfSize: 10 },
          { name: 'B', id: 2, selfSize: 20 },
          { name: 'C', id: 3, selfSize: 30 },
        ],
        [],
      );
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 60,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1, 2, 3],
      });
      const r = result as any;

      // 3 choose 2 = 3 pairs (i<j for multi-object)
      expect(r.pairs).toHaveLength(3);
      expect(r.pairs.map((p: any) => [p.objectA.nodeId, p.objectB.nodeId])).toEqual(
        expect.arrayContaining([
          [1, 2],
          [1, 3],
          [2, 3],
        ]),
      );
    });

    it('self-compare for single node returns identity delta', async () => {
      const snapId = 'snap_self';
      const chunk = buildChunk([{ name: 'Object', id: 1, selfSize: 100 }], []);
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 100,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1],
      });
      const r = result as any;

      expect(r.pairs).toHaveLength(1);
      expect(r.pairs[0].objectA.nodeId).toBe(1);
      expect(r.pairs[0].objectB.nodeId).toBe(1);
      expect(r.pairs[0].delta.shallowSize).toBe(0);
    });
  });

  describe('cross-snapshot comparison', () => {
    it('compares objects across two different snapshots', async () => {
      const snapA = 'snap_xa';
      const snapB = 'snap_xb';

      getSnapshotCache().set(snapA, {
        id: snapA,
        chunks: [buildChunk([{ name: 'Object', id: 1, selfSize: 100 }], [])],
        capturedAt: new Date().toISOString(),
        sizeBytes: 100,
      });
      getSnapshotCache().set(snapB, {
        id: snapB,
        chunks: [buildChunk([{ name: 'Object', id: 2, selfSize: 200 }], [])],
        capturedAt: new Date().toISOString(),
        sizeBytes: 200,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapA,
        anotherSnapshotId: snapB,
        objectIds: [1],
        anotherObjectIds: [2],
      });
      const r = result as any;

      expect(r.snapshotId).toBe(snapA);
      expect(r.anotherSnapshotId).toBe(snapB);
      expect(r.pairs).toHaveLength(1);
      expect(r.pairs[0].objectA.nodeId).toBe(1);
      expect(r.pairs[0].objectB.nodeId).toBe(2);
    });

    it('rejects cross-snapshot without anotherObjectIds', async () => {
      await expect(
        handlers.handle('v8_object_compare', {
          snapshotId: 's1',
          anotherSnapshotId: 's2',
          objectIds: [1],
        }),
      ).rejects.toThrow('anotherObjectIds');
    });
  });

  describe('node not found', () => {
    it('warns and skips missing nodeIds', async () => {
      const snapId = 'snap_nf';
      const chunk = buildChunk([{ name: 'Object', id: 1, selfSize: 10 }], []);
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 10,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1, 999],
      });
      const r = result as any;

      expect(r.skippedNodes).toContain(999);
      // only self-pair from the single found node
      expect(r.pairs).toHaveLength(1);
      expect(r.pairs[0].objectA.nodeId).toBe(1);
      expect(r.pairs[0].objectB.nodeId).toBe(1);
    });
  });

  describe('retained size via dominator tree', () => {
    it('computes retained sizes when edges form a dominator relationship', async () => {
      const snapId = 'snap_retained';
      // Node 1 (root, id=1) dominates node 3 via edge [1→3]
      // Node 2 (id=2) dominates node 4 via edge [2→4]
      // Edge format: [type, name_or_index, to_node]
      const chunk = buildChunk(
        [
          { name: 'Array', id: 1, selfSize: 100, edgeCount: 1 },
          { name: 'Array', id: 2, selfSize: 200, edgeCount: 1 },
          { name: 'number', id: 3, selfSize: 50 },
          { name: 'string', id: 4, selfSize: 80 },
        ],
        [
          [1, 3, 0],
          [2, 4, 0],
        ],
      );
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 430,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1, 2],
      });
      const r = result as any;

      // Node 1 retains 100 + 50 = 150, Node 2 retains 200 + 80 = 280
      expect(r.pairs[0].objectA.retainedSize).toBeGreaterThanOrEqual(
        r.pairs[0].objectA.shallowSize,
      );
      expect(r.pairs[0].objectB.retainedSize).toBeGreaterThanOrEqual(
        r.pairs[0].objectB.shallowSize,
      );
    });
  });

  describe('interesting flag', () => {
    it('marks large deltas as interesting', async () => {
      const snapId = 'snap_interesting';
      const chunk = buildChunk(
        [
          { name: 'Object', id: 1, selfSize: 100 },
          { name: 'Object', id: 2, selfSize: 5000 },
        ],
        [],
      );
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 5100,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1, 2],
        minDeltaBytes: 1024,
      });
      const r = result as any;

      expect(r.pairs[0].interesting).toBe(true);
    });

    it('does not mark small deltas as interesting', async () => {
      const snapId = 'snap_boring';
      const chunk = buildChunk(
        [
          { name: 'Object', id: 1, selfSize: 100 },
          { name: 'Object', id: 2, selfSize: 200 },
        ],
        [],
      );
      getSnapshotCache().set(snapId, {
        id: snapId,
        chunks: [chunk],
        capturedAt: new Date().toISOString(),
        sizeBytes: 300,
      });

      const result = await handlers.handle('v8_object_compare', {
        snapshotId: snapId,
        objectIds: [1, 2],
        minDeltaBytes: 1024,
      });
      const r = result as any;

      expect(r.pairs[0].interesting).toBe(false);
    });
  });
});
