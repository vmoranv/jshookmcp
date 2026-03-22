import { parseJson } from '@tests/server/domains/shared/mock-factories';
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



describe('GraphQLToolHandlersCallGraph', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: GraphQLToolHandlersCallGraph;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersCallGraph(collector);
  });

  // ── argument validation ─────────────────────────────────────────────

  describe('argument validation', () => {
    it('returns error for invalid filterPattern regex', async () => {
      const response = await handlers.handleCallGraphAnalyze({
        filterPattern: '[unclosed',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Invalid filterPattern regex');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.context).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.context.filterPattern).toBe('[unclosed');
    });

    it('accepts empty filterPattern', async () => {
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({ filterPattern: '' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
    });

    it('accepts missing filterPattern', async () => {
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
    });

    it('accepts valid regex filterPattern', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: 'fetch.*',
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({ filterPattern: 'fetch.*' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
    });
  });

  // ── maxDepth argument ───────────────────────────────────────────────

  describe('maxDepth argument', () => {
    it('uses default maxDepth of 5', async () => {
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

      await handlers.handleCallGraphAnalyze({});

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 5 })
      );
    });

    it('passes custom maxDepth', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 10,
          filterPattern: null,
        },
      });

      await handlers.handleCallGraphAnalyze({ maxDepth: 10 });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 10 })
      );
    });

    it('clamps maxDepth to min of 1', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 1,
          filterPattern: null,
        },
      });

      await handlers.handleCallGraphAnalyze({ maxDepth: -5 });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 1 })
      );
    });

    it('clamps maxDepth to max of 20', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 20,
          filterPattern: null,
        },
      });

      await handlers.handleCallGraphAnalyze({ maxDepth: 100 });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 20 })
      );
    });
  });

  // ── successful analysis ─────────────────────────────────────────────

  describe('successful analysis', () => {
    it('returns nodes, edges, and stats', async () => {
      const nodes: CallGraphNode[] = [
        { id: 'main', name: 'main', callCount: 10 },
        { id: 'helper', name: 'helper', callCount: 5 },
      ];
      const edges: CallGraphEdge[] = [{ source: 'main', target: 'helper', count: 5 }];
      const stats = {
        scannedRecords: 20,
        acceptedRecords: 15,
        nodeCount: 2,
        edgeCount: 1,
        maxDepth: 5,
        filterPattern: null,
      };

      page.evaluate.mockResolvedValueOnce({ nodes, edges, stats });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.nodes).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.edges).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.nodes[0].name).toBe('main');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.edges[0].source).toBe('main');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.edges[0].target).toBe('helper');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.scannedRecords).toBe(20);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.acceptedRecords).toBe(15);
    });

    it('returns empty graph for no data', async () => {
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.nodes).toHaveLength(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.edges).toHaveLength(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.nodesReturned).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.edgesReturned).toBe(0);
    });

    it('passes filterPattern to page.evaluate', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: [],
        stats: {
          scannedRecords: 0,
          acceptedRecords: 0,
          nodeCount: 0,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: 'test',
        },
      });

      await handlers.handleCallGraphAnalyze({ filterPattern: 'test' });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ filterPattern: 'test' })
      );
    });
  });

  // ── node/edge truncation ────────────────────────────────────────────

  describe('truncation', () => {
    it('truncates nodes when exceeding GRAPHQL_MAX_GRAPH_NODES', async () => {
      const manyNodes: CallGraphNode[] = Array.from({ length: 3000 }, (_, i) => ({
        id: `fn_${i}`,
        name: `fn_${i}`,
        callCount: 1,
      }));

      page.evaluate.mockResolvedValueOnce({
        nodes: manyNodes,
        edges: [],
        stats: {
          scannedRecords: 3000,
          acceptedRecords: 3000,
          nodeCount: 3000,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.nodesTruncated).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.nodesReturned).toBe(2000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.nodes).toHaveLength(2000);
    });

    it('truncates edges when exceeding GRAPHQL_MAX_GRAPH_EDGES', async () => {
      const manyEdges: CallGraphEdge[] = Array.from({ length: 6000 }, (_, i) => ({
        source: `src_${i}`,
        target: `tgt_${i}`,
        count: 1,
      }));

      page.evaluate.mockResolvedValueOnce({
        nodes: [],
        edges: manyEdges,
        stats: {
          scannedRecords: 6000,
          acceptedRecords: 6000,
          nodeCount: 0,
          edgeCount: 6000,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.edgesTruncated).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.edgesReturned).toBe(5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.edges).toHaveLength(5000);
    });

    it('sets nodesTruncated to false when under limit', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [{ id: 'a', name: 'a', callCount: 1 }],
        edges: [],
        stats: {
          scannedRecords: 1,
          acceptedRecords: 1,
          nodeCount: 1,
          edgeCount: 0,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.nodesTruncated).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.edgesTruncated).toBe(false);
    });
  });

  // ── stats metadata ──────────────────────────────────────────────────

  describe('stats metadata', () => {
    it('includes nodesReturned and edgesReturned', async () => {
      page.evaluate.mockResolvedValueOnce({
        nodes: [
          { id: 'a', name: 'a', callCount: 3 },
          { id: 'b', name: 'b', callCount: 2 },
        ],
        edges: [{ source: 'a', target: 'b', count: 2 }],
        stats: {
          scannedRecords: 5,
          acceptedRecords: 3,
          nodeCount: 2,
          edgeCount: 1,
          maxDepth: 5,
          filterPattern: null,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleCallGraphAnalyze({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.nodesReturned).toBe(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.edgesReturned).toBe(1);
    });

    it('merges stats from page evaluate', async () => {
      const originalStats = {
        scannedRecords: 42,
        acceptedRecords: 30,
        nodeCount: 10,
        edgeCount: 8,
        maxDepth: 7,
        filterPattern: 'test.*',
      };
      page.evaluate.mockResolvedValueOnce({
        nodes: Array.from({ length: 10 }, (_, i) => ({
          id: `n${i}`,
          name: `n${i}`,
          callCount: 1,
        })),
        edges: Array.from({ length: 8 }, (_, i) => ({
          source: `s${i}`,
          target: `t${i}`,
          count: 1,
        })),
        stats: originalStats,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleCallGraphAnalyze({ maxDepth: 7, filterPattern: 'test.*' })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.scannedRecords).toBe(42);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.acceptedRecords).toBe(30);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.maxDepth).toBe(7);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.filterPattern).toBe('test.*');
    });
  });

  // ── error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('catches unexpected exceptions', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      collector.getActivePage.mockRejectedValueOnce(new Error('Browser crashed'));

      const response = await handlers.handleCallGraphAnalyze({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('Browser crashed');
    });

    it('catches page.evaluate errors', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('Script timeout'));

      const response = await handlers.handleCallGraphAnalyze({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('Script timeout');
    });

    it('includes reason in invalid regex context', async () => {
      const response = await handlers.handleCallGraphAnalyze({
        filterPattern: '(?P<invalid>)',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((response as any).isError).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.context.reason).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(typeof body.context.reason).toBe('string');
    });
  });
});
