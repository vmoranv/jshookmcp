import { describe, expect, it } from 'vitest';
import { HeapSnapshotParser } from '@modules/v8-inspector/HeapSnapshotParser';

describe('HeapSnapshotParser', () => {
  it('parses line-based heap snapshot nodes', () => {
    const snapshot = [
      JSON.stringify({ snapshot: { node_types: [['object']] }, strings: ['(root)', 'MyObject'] }),
      JSON.stringify([0, 'MyObject', 1, 64]),
      JSON.stringify([0, 'MyObject', 2, 32]),
    ].join('\n');
    const parser = new HeapSnapshotParser(snapshot);
    const nodes = parser.parseNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.name).toBe('MyObject');
  });

  it('parses standard heap snapshot payloads', () => {
    const snapshot = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
          edge_fields: ['type', 'name_or_index', 'to_node'],
          node_types: [['object']],
          edge_types: [['property']],
        },
      },
      strings: ['root'],
      nodes: [0, 0, 1, 64, 0],
      edges: [],
    });
    const parser = new HeapSnapshotParser(snapshot);
    expect(parser.parseNodes()).toHaveLength(1);
  });

  it('exports summary and retained sizes', () => {
    const snapshot = [
      JSON.stringify({ snapshot: { node_types: [['object']] }, strings: ['(root)', 'MyObject'] }),
      JSON.stringify([0, 'MyObject', 1, 64]),
    ].join('\n');
    const parser = new HeapSnapshotParser(snapshot);
    expect(parser.exportSummary().totalNodes).toBe(1);
    expect(Array.from(parser.computeRetainedSizes().keys())).toContain(1);
  });
});
