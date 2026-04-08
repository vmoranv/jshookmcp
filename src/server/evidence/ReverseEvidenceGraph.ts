/**
 * ReverseEvidenceGraph — queryable, exportable reverse engineering evidence chain.
 *
 * Models provenance: request → initiator-stack → script → function →
 * breakpoint-hook → captured-data → replay-artifact.
 *
 * Requirements: EVID-01 (data structure), EVID-02 (query), EVID-03 (export).
 */
import type {
  EvidenceNode,
  EvidenceNodeType,
  EvidenceEdge,
  EvidenceEdgeType,
  EvidenceGraphSnapshot,
} from './types';

let nextId = 1;
function generateId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

/** Reset ID counter (for testing only). */
export function _resetIdCounter(): void {
  nextId = 1;
}

export class ReverseEvidenceGraph {
  private readonly nodes = new Map<string, EvidenceNode>();
  private readonly edges = new Map<string, EvidenceEdge>();

  // ── CRUD ──────────────────────────────────────────────

  /** Add a node to the graph. */
  addNode(
    type: EvidenceNodeType,
    label: string,
    metadata: Record<string, unknown> = {},
  ): EvidenceNode {
    const node: EvidenceNode = {
      id: generateId(type),
      type,
      label,
      metadata,
      createdAt: Date.now(),
    };
    this.nodes.set(node.id, node);
    return node;
  }

  /** Add a directed edge between two nodes. */
  addEdge(
    sourceId: string,
    targetId: string,
    type: EvidenceEdgeType,
    metadata?: Record<string, unknown>,
  ): EvidenceEdge {
    if (!this.nodes.has(sourceId)) throw new Error(`Source node "${sourceId}" not found`);
    if (!this.nodes.has(targetId)) throw new Error(`Target node "${targetId}" not found`);

    const edge: EvidenceEdge = {
      id: generateId('edge'),
      source: sourceId,
      target: targetId,
      type,
      metadata,
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  /** Get a node by ID. */
  getNode(id: string): EvidenceNode | undefined {
    return this.nodes.get(id);
  }

  /** Remove a node and all connected edges. */
  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;
    this.nodes.delete(id);
    // Cascade: remove all edges connected to this node
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === id || edge.target === id) {
        this.edges.delete(edgeId);
      }
    }
    return true;
  }

  /** Get all edges originating from a node. */
  getEdgesFrom(nodeId: string): EvidenceEdge[] {
    return [...this.edges.values()].filter((e) => e.source === nodeId);
  }

  /** Get all edges pointing to a node. */
  getEdgesTo(nodeId: string): EvidenceEdge[] {
    return [...this.edges.values()].filter((e) => e.target === nodeId);
  }

  /** Get total node count. */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Get total edge count. */
  get edgeCount(): number {
    return this.edges.size;
  }

  // ── Chain Traversal ───────────────────────────────────

  /**
   * BFS traversal from a node, following edges in the given direction.
   * Returns all reachable nodes (including the start node).
   */
  getEvidenceChain(nodeId: string, direction: 'forward' | 'backward' = 'forward'): EvidenceNode[] {
    const start = this.nodes.get(nodeId);
    if (!start) return [];

    const visited = new Set<string>();
    const queue: string[] = [nodeId];
    const result: EvidenceNode[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.nodes.get(current);
      if (node) result.push(node);

      // Find connected nodes based on direction
      const connectedEdges =
        direction === 'forward' ? this.getEdgesFrom(current) : this.getEdgesTo(current);

      for (const edge of connectedEdges) {
        const nextNodeId = direction === 'forward' ? edge.target : edge.source;
        if (!visited.has(nextNodeId)) {
          queue.push(nextNodeId);
        }
      }
    }

    return result;
  }

  // ── Query Engine ──────────────────────────────────────

  /**
   * Find all nodes associated with a URL.
   * Searches request nodes by URL metadata, then returns connected subgraph.
   */
  queryByUrl(url: string): EvidenceNode[] {
    const matchingNodes = [...this.nodes.values()].filter((n) => {
      if (n.type === 'request' && typeof n.metadata.url === 'string') {
        return n.metadata.url.includes(url);
      }
      if (typeof n.metadata.url === 'string') {
        return n.metadata.url.includes(url);
      }
      return false;
    });

    // Expand to connected subgraph
    const allNodes = new Set<string>();
    for (const node of matchingNodes) {
      for (const n of this.getEvidenceChain(node.id, 'forward')) {
        allNodes.add(n.id);
      }
      for (const n of this.getEvidenceChain(node.id, 'backward')) {
        allNodes.add(n.id);
      }
    }

    return [...allNodes].map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  /**
   * Find all nodes associated with a function name.
   * Searches function nodes, then returns connected subgraph.
   */
  queryByFunction(name: string): EvidenceNode[] {
    const matchingNodes = [...this.nodes.values()].filter((n) => {
      if (n.type === 'function' && typeof n.metadata.functionName === 'string') {
        return n.metadata.functionName.includes(name);
      }
      if (n.label.includes(name) && (n.type === 'function' || n.type === 'breakpoint-hook')) {
        return true;
      }
      return false;
    });

    const allNodes = new Set<string>();
    for (const node of matchingNodes) {
      for (const n of this.getEvidenceChain(node.id, 'forward')) {
        allNodes.add(n.id);
      }
      for (const n of this.getEvidenceChain(node.id, 'backward')) {
        allNodes.add(n.id);
      }
    }

    return [...allNodes].map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  /**
   * Find all nodes associated with a script ID.
   * Searches script nodes by scriptId metadata, then returns connected subgraph.
   */
  queryByScriptId(scriptId: string): EvidenceNode[] {
    const matchingNodes = [...this.nodes.values()].filter((n) => {
      if (n.type === 'script' && n.metadata.scriptId === scriptId) return true;
      return false;
    });

    const allNodes = new Set<string>();
    for (const node of matchingNodes) {
      for (const n of this.getEvidenceChain(node.id, 'forward')) {
        allNodes.add(n.id);
      }
      for (const n of this.getEvidenceChain(node.id, 'backward')) {
        allNodes.add(n.id);
      }
    }

    return [...allNodes].map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  // ── Export ─────────────────────────────────────────────

  /** Export the full graph as a JSON snapshot. */
  exportJson(): EvidenceGraphSnapshot {
    return {
      version: 1,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      exportedAt: new Date().toISOString(),
    };
  }

  /** Export the graph as a readable Markdown report. */
  exportMarkdown(): string {
    const lines: string[] = [];
    lines.push('# Reverse Evidence Graph Report');
    lines.push('');
    lines.push(`**Exported:** ${new Date().toISOString()}`);
    lines.push(`**Nodes:** ${this.nodes.size} | **Edges:** ${this.edges.size}`);
    lines.push('');

    // Group nodes by type
    const byType = new Map<EvidenceNodeType, EvidenceNode[]>();
    for (const node of this.nodes.values()) {
      const list = byType.get(node.type) ?? [];
      list.push(node);
      byType.set(node.type, list);
    }

    // Output sections for each type
    const typeOrder: EvidenceNodeType[] = [
      'request',
      'initiator-stack',
      'script',
      'function',
      'breakpoint-hook',
      'captured-data',
      'replay-artifact',
      'v8-heap-object',
      'v8-hidden-class',
      'network-request',
      'network-response',
      'canvas-scene-node',
      'canvas-render-node',
      'skia-draw-call',
      'syscall-event',
      'mojo-message',
      'mojo-interface',
      'binary-symbol',
      'binary-function',
      'binary-module',
      'proto-message',
      'proto-state',
    ];

    for (const type of typeOrder) {
      const nodes = byType.get(type);
      if (!nodes || nodes.length === 0) continue;

      lines.push(`## ${type} (${nodes.length})`);
      lines.push('');

      for (const node of nodes) {
        lines.push(`### ${node.label}`);
        lines.push(`- **ID:** \`${node.id}\``);
        lines.push(`- **Created:** ${new Date(node.createdAt).toISOString()}`);

        const metaKeys = Object.keys(node.metadata);
        if (metaKeys.length > 0) {
          for (const key of metaKeys) {
            const val = node.metadata[key];
            const display = typeof val === 'string' ? val : JSON.stringify(val);
            lines.push(`- **${key}:** ${display}`);
          }
        }

        // Show connected edges
        const outEdges = this.getEdgesFrom(node.id);
        const inEdges = this.getEdgesTo(node.id);

        if (outEdges.length > 0) {
          lines.push(
            `- **→ Out:** ${outEdges.map((e) => `${e.type} → \`${e.target}\``).join(', ')}`,
          );
        }
        if (inEdges.length > 0) {
          lines.push(`- **← In:** ${inEdges.map((e) => `\`${e.source}\` ${e.type} →`).join(', ')}`);
        }

        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
