/**
 * Coverage tests for HeapSnapshotParser — exercises feedChunk, the parsed-state
 * guard, node/edge queries, dominator/retained-size computation, top retainers,
 * and diff, using minimal/empty snapshot JSON (the heavy V8 format is exercised
 * end-to-end elsewhere).
 */

import { describe, expect, it } from 'vitest';
import { HeapSnapshotParser } from '@modules/v8-inspector/HeapSnapshotParser';

const EMPTY = JSON.stringify({
  snapshot: { meta: { node_fields: [], node_types: [], edge_fields: [], edge_types: [] } },
  nodes: [],
  edges: [],
  strings: [],
});

describe('HeapSnapshotParser — construction + empty parse', () => {
  it('parses an empty snapshot via the constructor', () => {
    const p = new HeapSnapshotParser(EMPTY);
    expect(p.nodeCount).toBe(0);
    expect(p.getAllNodes()).toEqual([]);
    expect(p.parseEdges()).toEqual([]);
  });

  it('parses an empty snapshot via feedChunk', () => {
    const p = new HeapSnapshotParser();
    p.feedChunk([EMPTY]);
    expect(p.nodeCount).toBe(0);
  });

  it('feedChunk after parsing already started throws', () => {
    const p = new HeapSnapshotParser();
    p.feedChunk([EMPTY]);
    expect(() => p.feedChunk([EMPTY])).toThrow(/already parsed/);
  });

  it('feedChunk skips empty/non-string chunks', () => {
    const p = new HeapSnapshotParser();
    p.feedChunk(['', EMPTY]);
    expect(p.nodeCount).toBe(0);
  });
});

describe('HeapSnapshotParser — queries on empty data', () => {
  const p = new HeapSnapshotParser(EMPTY);

  it('getNodesByClassName / getObjectsByType return [] on empty', () => {
    expect(p.getNodesByClassName('Object')).toEqual([]);
    expect(p.getObjectsByType('object')).toEqual([]);
  });

  it('buildDominatorTree returns an empty Map on empty data', () => {
    expect(p.buildDominatorTree().size).toBe(0);
  });

  it('getAllRetainedSizes returns [] on empty', () => {
    expect(p.getAllRetainedSizes()).toEqual([]);
  });

  it('getTopRetainers returns [] on empty', () => {
    expect(p.getTopRetainers(5)).toEqual([]);
  });
});

describe('HeapSnapshotParser — diff', () => {
  it('diffing two empty snapshots yields an empty-ish delta', () => {
    const a = new HeapSnapshotParser(EMPTY);
    const b = new HeapSnapshotParser(EMPTY);
    const d = a.diff(b);
    expect(d).toBeDefined();
  });
});

describe('HeapSnapshotParser — malformed input', () => {
  it('handles invalid JSON gracefully (empty result, no throw from public API)', () => {
    const p = new HeapSnapshotParser('not-json');
    expect(p.nodeCount).toBe(0);
    expect(p.getAllNodes()).toEqual([]);
  });
});

describe('HeapSnapshotParser — real 2-node snapshot (deep parse)', () => {
  // Standard V8 heap-snapshot shape: snapshot.meta carries node_fields/edge_fields;
  // nodes/edges/strings are flat top-level arrays.
  const TWO_NODES = JSON.stringify({
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
        node_types: [['hidden', 'array', 'string', 'object']],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['context', 'element', 'property']],
      },
    },
    nodes: [
      0,
      0,
      1,
      16,
      1, // node 0 @ offset 0: hidden "Root", id 1, 1 edge
      3,
      1,
      2,
      32,
      0, // node 1 @ offset 5: object "Obj",  id 2, 0 edges
    ],
    edges: [1, 0, 5], // element edge Root → Obj (offset 5)
    strings: ['Root', 'Obj'],
  });

  it('parses both nodes with correct names/types/sizes', () => {
    const p = new HeapSnapshotParser(TWO_NODES);
    expect(p.nodeCount).toBe(2);
    const nodes = p.getAllNodes();
    expect(nodes[0]?.name).toBe('Root');
    expect(nodes[1]?.name).toBe('Obj');
  });

  it('parses the edge', () => {
    const p = new HeapSnapshotParser(TWO_NODES);
    expect(p.parseEdges().length).toBe(1);
  });

  it('getNodesByClassName / getObjectsByType filter correctly', () => {
    const p = new HeapSnapshotParser(TWO_NODES);
    expect(p.getNodesByClassName('Obj')).toHaveLength(1);
    expect(p.getObjectsByType('object')).toHaveLength(1);
  });

  it('computeRetainedSizes walks the dominator tree (Root retains Obj)', () => {
    const p = new HeapSnapshotParser(TWO_NODES);
    const sizes = p.getAllRetainedSizes();
    const root = sizes.find((s) => s.id === 1);
    const obj = sizes.find((s) => s.id === 2);
    expect(root?.retainedSize).toBe(48); // 16 + 32
    expect(obj?.retainedSize).toBe(32);
  });

  it('attributes a multiply referenced node to its immediate dominator', () => {
    const diamond = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
          node_types: [['hidden', 'array', 'string', 'object']],
          edge_fields: ['type', 'name_or_index', 'to_node'],
          edge_types: [['context', 'element', 'property']],
        },
      },
      nodes: [0, 0, 1, 10, 2, 3, 1, 2, 20, 1, 3, 2, 3, 30, 1, 3, 3, 4, 40, 0],
      edges: [1, 0, 5, 1, 0, 10, 1, 0, 15, 1, 0, 15],
      strings: ['Root', 'Left', 'Right', 'Shared'],
    });
    const sizes = new Map(
      new HeapSnapshotParser(diamond)
        .getAllRetainedSizes()
        .map(({ id, retainedSize }) => [id, retainedSize]),
    );

    expect(sizes.get(1)).toBe(100);
    expect(sizes.get(2)).toBe(20);
    expect(sizes.get(3)).toBe(30);
    expect(sizes.get(4)).toBe(40);
  });

  it('getTopRetainers returns sorted retainers', () => {
    const p = new HeapSnapshotParser(TWO_NODES);
    const top = p.getTopRetainers(5);
    expect(top.length).toBeGreaterThan(0);
  });

  it('buildDominatorTree returns a node→dominator map', () => {
    const p = new HeapSnapshotParser(TWO_NODES);
    const dom = p.buildDominatorTree();
    expect(dom.size).toBeGreaterThan(0);
  });

  // Multi-chunk standard snapshots must still parse as standard format.
  // feedChunk joins chunks with '\n'; the previous format heuristic
  // (`startsWith('{') && !includes('\n')`) misrouted any standard snapshot
  // split across >1 chunk to parseLineSnapshot, silently producing zero
  // nodes. The new looksLikeStandardSnapshot() probe checks the parsed
  // shape, so splitting on '\n' no longer corrupts routing.
  it('parses a multi-chunk standard snapshot split across chunks', () => {
    const full = TWO_NODES;
    // Split into 3 uneven chunks. Concatenation is the original JSON; the
    // '\n' join between them must not flip format detection.
    const cut1 = Math.floor(full.length / 3);
    const cut2 = Math.floor((full.length * 2) / 3);
    const chunks = [full.slice(0, cut1), full.slice(cut1, cut2), full.slice(cut2)];

    const p = new HeapSnapshotParser();
    p.feedChunk(chunks);

    expect(p.nodeCount).toBe(2);
    const nodes = p.getAllNodes();
    expect(nodes[0]?.name).toBe('Root');
    expect(nodes[1]?.name).toBe('Obj');
    expect(p.parseEdges().length).toBe(1);
  });

  // And the hostile-but-real case: a pretty-printed standard JSON snapshot
  // (newlines INSIDE one chunk). The old heuristic excluded any string with
  // '\n'; a pretty-printed single-chunk snapshot would have been misrouted
  // to parseLineSnapshot too.
  it('parses a pretty-printed (multi-line) standard snapshot in one chunk', () => {
    const pretty = JSON.stringify(JSON.parse(TWO_NODES), null, 2);
    expect(pretty.includes('\n')).toBe(true);

    const p = new HeapSnapshotParser();
    p.feedChunk([pretty]);

    expect(p.nodeCount).toBe(2);
    expect(p.getAllNodes()[0]?.name).toBe('Root');
  });
});

describe('HeapSnapshotParser — line-format snapshot (parseLineSnapshot)', () => {
  // The line format (multi-line text) routes through parseLineSnapshot:
  // first line = meta JSON, subsequent lines = JSON record arrays where
  // tag 0 = node (compact: [0, "name", id, selfSize]) and tag 1 = edge.
  const LINE_FORMAT = [
    JSON.stringify({
      node_types: [['hidden', 'object']],
      edge_types: [['element', 'property']],
      strings: ['Root', 'Obj'],
    }),
    '[0, "Root", 1, 16]',
    '[0, "Obj", 2, 32]',
  ].join('\n');

  it('parses compact node records from the line format', () => {
    const p = new HeapSnapshotParser();
    p.feedChunk([LINE_FORMAT]);
    expect(p.nodeCount).toBe(2);
    const names = p.getAllNodes().map((n) => n.name);
    expect(names).toContain('Root');
    expect(names).toContain('Obj');
  });

  it('queries + retained sizes work on line-format data', () => {
    const p = new HeapSnapshotParser();
    p.feedChunk([LINE_FORMAT]);
    // Compact records use typeIdx 0 → first node type ("hidden"), so filter on that.
    expect(p.getObjectsByType('hidden').length).toBeGreaterThan(0);
    expect(p.getAllRetainedSizes().length).toBe(2);
    expect(p.getTopRetainers(5).length).toBeGreaterThan(0);
  });

  it('returns empty for a line-format snapshot with only a meta line', () => {
    const p = new HeapSnapshotParser();
    p.feedChunk([JSON.stringify({ node_types: [[]], edge_types: [[]], strings: [] })]);
    expect(p.nodeCount).toBe(0);
  });
});
