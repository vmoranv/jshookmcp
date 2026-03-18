import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersCallGraph } from '@server/domains/graphql/handlers.impl.core.runtime.callgraph';
import type {
  CallGraphNode,
  CallGraphEdge,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import {
  GRAPHQL_MAX_GRAPH_NODES,
  GRAPHQL_MAX_GRAPH_EDGES,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';

function parseJson(response: any) {
  return JSON.parse(response.content[0]!.text);
}

describe('GraphQLToolHandlersCallGraph - edge cases', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: GraphQLToolHandlersCallGraph;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersCallGraph(collector);
  });

  describe('filterPattern edge cases', () => {
    it('rejects regex with invalid group syntax', async () => {
      const response = await handlers.handleCallGraphAnalyze({
        filterPattern: '(?P<name>invalid)',
      });
      expect((response as any).isError).toBe(true);
      const body = parseJson(response);
      expect(body.context.filterPattern).toBe('(?P<name>invalid)');
    });

    it('rejects unclosed character class', async () => {
      const response = await handlers.handleCallGraphAnalyze({
        filterPattern: '[a-z',
      });
      expect((response as any).isError).toBe(true);
    });

    it('accepts complex but valid regex', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: '^(get|set)[A-Z]',
        },
      });

      const body = parseJson(
        await handlers.handleCallGraphAnalyze({ filterPattern: '^(get|set)[A-Z]' })
      );
      expect(body.success).toBe(true);
    });

    it('handles whitespace-only filterPattern as empty', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({ filterPattern: '   ' }));
      expect(body.success).toBe(true);
      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ filterPattern: '' })
      );
    });
  });

  describe('maxDepth edge cases', () => {
    it('handles NaN string maxDepth by using default', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      await handlers.handleCallGraphAnalyze({ maxDepth: 'not-a-number' });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 5 })
      );
    });

    it('truncates float maxDepth to integer', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 7,
          filterPattern: null,
        },
      });

      await handlers.handleCallGraphAnalyze({ maxDepth: 7.9 });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 7 })
      );
    });

    it('accepts string numeric maxDepth', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 15,
          filterPattern: null,
        },
      });

      await handlers.handleCallGraphAnalyze({ maxDepth: '15' });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 15 })
      );
    });
  });

  describe('boundary truncation', () => {
    it('reports nodesTruncated=false at exact limit', async () => {
      const exactNodes: CallGraphNode[] = Array.from(
        { length: GRAPHQL_MAX_GRAPH_NODES },
        (_, i) => ({
          id: `fn_${i}`,
          name: `fn_${i}`,
          callCount: 1,
        })
      );

      page.evaluate.mockResolvedValueOnce({
        nodes: exactNodes,
        edges: [],
        stats: {
          scannedRecords: GRAPHQL_MAX_GRAPH_NODES,
          acceptedRecords: GRAPHQL_MAX_GRAPH_NODES,
          nodeCount: GRAPHQL_MAX_GRAPH_NODES,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));

      expect(body.stats.nodesTruncated).toBe(false);
      expect(body.nodes).toHaveLength(GRAPHQL_MAX_GRAPH_NODES);
    });

    it('reports nodesTruncated=true at limit+1', async () => {
      const overNodes: CallGraphNode[] = Array.from(
        { length: GRAPHQL_MAX_GRAPH_NODES + 1 },
        (_, i) => ({
          id: `fn_${i}`,
          name: `fn_${i}`,
          callCount: 1,
        })
      );

      page.evaluate.mockResolvedValueOnce({
        nodes: overNodes,
        edges: [],
        stats: {
          scannedRecords: GRAPHQL_MAX_GRAPH_NODES + 1,
          acceptedRecords: GRAPHQL_MAX_GRAPH_NODES + 1,
          nodeCount: GRAPHQL_MAX_GRAPH_NODES + 1,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));

      expect(body.stats.nodesTruncated).toBe(true);
      expect(body.nodes).toHaveLength(GRAPHQL_MAX_GRAPH_NODES);
      expect(body.stats.nodesReturned).toBe(GRAPHQL_MAX_GRAPH_NODES);
    });

    it('reports edgesTruncated=false at exact limit', async () => {
      const exactEdges: CallGraphEdge[] = Array.from(
        { length: GRAPHQL_MAX_GRAPH_EDGES },
        (_, i) => ({
          source: `src_${i}`,
          target: `tgt_${i}`,
          count: 1,
        })
      );

      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: exactEdges,
        stats: {
          scannedRecords: GRAPHQL_MAX_GRAPH_EDGES,
          acceptedRecords: GRAPHQL_MAX_GRAPH_EDGES,
          nodeCount: 0,
          edgeCount: GRAPHQL_MAX_GRAPH_EDGES,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));

      expect(body.stats.edgesTruncated).toBe(false);
      expect(body.edges).toHaveLength(GRAPHQL_MAX_GRAPH_EDGES);
    });
  });

  describe('both nodes and edges truncation', () => {
    it('truncates both when both exceed limits', async () => {
      const manyNodes: CallGraphNode[] = Array.from(
        { length: GRAPHQL_MAX_GRAPH_NODES + 500 },
        (_, i) => ({
          id: `fn_${i}`,
          name: `fn_${i}`,
          callCount: 1,
        })
      );
      const manyEdges: CallGraphEdge[] = Array.from(
        { length: GRAPHQL_MAX_GRAPH_EDGES + 500 },
        (_, i) => ({
          source: `src_${i}`,
          target: `tgt_${i}`,
          count: 1,
        })
      );

      page.evaluate.mockResolvedValueOnce({
        nodes: manyNodes,
        edges: manyEdges,
        stats: {
          scannedRecords: 10000,
          acceptedRecords: 10000,
          nodeCount: manyNodes.length,
          edgeCount: manyEdges.length,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));

      expect(body.stats.nodesTruncated).toBe(true);
      expect(body.stats.edgesTruncated).toBe(true);
      expect(body.nodes).toHaveLength(GRAPHQL_MAX_GRAPH_NODES);
      expect(body.edges).toHaveLength(GRAPHQL_MAX_GRAPH_EDGES);
    });
  });

  describe('error propagation', () => {
    it('handles non-Error thrown objects', async () => {
      collector.getActivePage.mockRejectedValueOnce('string error');

      const response = await handlers.handleCallGraphAnalyze({});
      const body = parseJson(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toBe('string error');
    });

    it('handles page.evaluate returning null', async () => {
      page.evaluate.mockResolvedValueOnce(null);

      const response = await handlers.handleCallGraphAnalyze({});
      expect((response as any).isError).toBe(true);
    });
  });
});
