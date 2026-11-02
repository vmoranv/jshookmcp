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
export function resetIdCounter(): void {
  nextId = 1;
}

import type { EventBus, ServerEventMap } from '@server/EventBus';
import { logger } from '@utils/logger';

/** Default cap on stored nodes before oldest entries are evicted. */
const DEFAULT_MAX_NODES = 100_000;
/** Default cap on stored edges before oldest entries are evicted. */
const DEFAULT_MAX_EDGES = 100_000;

export interface ReverseEvidenceGraphOptions {
  /** Cap on stored nodes; oldest (by createdAt) are evicted when exceeded. */
  maxNodes?: number;
  /** Cap on stored edges; oldest (by insertion order) are evicted when exceeded. */
  maxEdges?: number;
}

export class ReverseEvidenceGraph {
  private readonly nodes = new Map<string, EvidenceNode>();
  private readonly edges = new Map<string, EvidenceEdge>();
  private readonly outgoingEdgeIds = new Map<string, Set<string>>();
  private readonly incomingEdgeIds = new Map<string, Set<string>>();
  private readonly maxNodes: number;
  private readonly maxEdges: number;
  private eventBus?: EventBus<ServerEventMap>;
  private isDirty = false;
  private mutationSeq = 0;
  private lastPersistedSeq = 0;
  private persistNotifier?: () => void;
  private droppedNodes = 0;
  private droppedEdges = 0;

  constructor(options: ReverseEvidenceGraphOptions = {}) {
    this.maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    this.maxEdges = options.maxEdges ?? DEFAULT_MAX_EDGES;
  }

  setEventBus(eventBus: EventBus<ServerEventMap>): void {
    this.eventBus = eventBus;
  }

  setPersistNotifier(notify?: () => void): void {
    this.persistNotifier = notify;
  }

  private markDirty(): void {
    this.isDirty = true;
    this.mutationSeq++;
    this.persistNotifier?.();
  }

  commit(): void {
    if (this.isDirty && this.eventBus) {
      this.isDirty = false;
      void this.eventBus.emit('evidence:updated', {
        timestamp: new Date().toISOString(),
        reason: 'Tool execution committed changes',
      });
    }
  }

  // ── Unbounded growth caps ─────────────────────────────

  /**
   * Surface an eviction batch to observers. Eviction is otherwise silent; a
   * long-lived session can silently lose evidence without any signal. We warn
   * once per batch (the batch, not the individual node/edge, is the unit of
   * rate limiting) and emit an event when a bus is attached.
   */
  private notifyEviction(
    reason: 'node-cap' | 'edge-cap',
    droppedNodes: number,
    droppedEdges: number,
  ): void {
    if (droppedNodes === 0 && droppedEdges === 0) return;
    logger.warn(
      `[ReverseEvidenceGraph] evicted ${droppedNodes} node(s) and ${droppedEdges} edge(s) (${reason})`,
    );
    void this.eventBus?.emit('evidence-evicted', {
      reason,
      droppedNodes,
      droppedEdges,
      timestamp: new Date().toISOString(),
    });
  }

  private indexEdge(edge: EvidenceEdge): void {
    const outgoing = this.outgoingEdgeIds.get(edge.source) ?? new Set<string>();
    outgoing.add(edge.id);
    this.outgoingEdgeIds.set(edge.source, outgoing);

    const incoming = this.incomingEdgeIds.get(edge.target) ?? new Set<string>();
    incoming.add(edge.id);
    this.incomingEdgeIds.set(edge.target, incoming);
  }

  private deleteEdge(edgeId: string): boolean {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;
    this.edges.delete(edgeId);

    const outgoing = this.outgoingEdgeIds.get(edge.source);
    outgoing?.delete(edgeId);
    if (outgoing?.size === 0) this.outgoingEdgeIds.delete(edge.source);

    const incoming = this.incomingEdgeIds.get(edge.target);
    incoming?.delete(edgeId);
    if (incoming?.size === 0) this.incomingEdgeIds.delete(edge.target);
    return true;
  }

  private deleteNodeAndConnectedEdges(nodeId: string): number {
    if (!this.nodes.delete(nodeId)) return 0;
    const connected = new Set([
      ...(this.outgoingEdgeIds.get(nodeId) ?? []),
      ...(this.incomingEdgeIds.get(nodeId) ?? []),
    ]);
    let removedEdges = 0;
    for (const edgeId of connected) {
      if (this.deleteEdge(edgeId)) removedEdges++;
    }
    this.outgoingEdgeIds.delete(nodeId);
    this.incomingEdgeIds.delete(nodeId);
    return removedEdges;
  }

  /** Evict the oldest nodes in insertion order down to the configured cap. */
  private evictOldestNodes(): void {
    const excess = this.nodes.size - this.maxNodes;
    if (excess <= 0) return;

    let removedNodes = 0;
    let cascadedEdges = 0;
    for (const nodeId of this.nodes.keys()) {
      if (removedNodes >= excess) break;
      cascadedEdges += this.deleteNodeAndConnectedEdges(nodeId);
      removedNodes++;
    }
    this.droppedNodes += removedNodes;
    this.droppedEdges += cascadedEdges;
    this.notifyEviction('node-cap', removedNodes, cascadedEdges);
  }

  /** Evict the oldest edges (by insertion order) down to the configured cap. */
  private evictOldestEdges(): void {
    const excess = this.edges.size - this.maxEdges;
    if (excess <= 0) return;
    // Edges carry no createdAt; Map iteration order equals insertion order, so
    // the oldest edges sit at the front.
    let removed = 0;
    for (const edgeId of this.edges.keys()) {
      if (removed >= excess) break;
      this.deleteEdge(edgeId);
      removed++;
    }
    this.droppedEdges += removed;
    this.notifyEviction('edge-cap', 0, removed);
  }

  /** Number of nodes evicted due to the node cap. */
  get droppedNodeCount(): number {
    return this.droppedNodes;
  }

  /** Number of edges evicted due to the edge cap or node-eviction cascades. */
  get droppedEdgeCount(): number {
    return this.droppedEdges;
  }

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
    this.evictOldestNodes();
    this.markDirty();
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
    this.indexEdge(edge);
    this.evictOldestEdges();
    this.markDirty();
    return edge;
  }

  /** Get a node by ID. */
  getNode(id: string): EvidenceNode | undefined {
    return this.nodes.get(id);
  }

  /** Remove a node and all connected edges. */
  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;
    this.deleteNodeAndConnectedEdges(id);
    this.markDirty();
    return true;
  }

  /** Get all edges originating from a node. */
  getEdgesFrom(nodeId: string): EvidenceEdge[] {
    return [...(this.outgoingEdgeIds.get(nodeId) ?? [])]
      .map((edgeId) => this.edges.get(edgeId))
      .filter((edge): edge is EvidenceEdge => edge !== undefined);
  }

  /** Whether an edge (source → target, type) already exists. */
  hasEdge(sourceId: string, targetId: string, type: EvidenceEdgeType): boolean {
    return this.getEdgesFrom(sourceId).some((e) => e.target === targetId && e.type === type);
  }

  /** Get all edges pointing to a node. */
  getEdgesTo(nodeId: string): EvidenceEdge[] {
    return [...(this.incomingEdgeIds.get(nodeId) ?? [])]
      .map((edgeId) => this.edges.get(edgeId))
      .filter((edge): edge is EvidenceEdge => edge !== undefined);
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

  // ── Snapshot Persistence ───────────────────────────────

  getSnapshotSeq(): number {
    return this.mutationSeq;
  }

  getLastPersistedSeq(): number {
    return this.lastPersistedSeq;
  }

  markPersisted(): void {
    this.lastPersistedSeq = this.mutationSeq;
  }

  isPersistDirty(): boolean {
    return this.mutationSeq !== this.lastPersistedSeq;
  }

  exportSnapshot(): {
    schemaVersion: number;
    savedAt: string;
    graph: EvidenceGraphSnapshot;
    droppedNodes: number;
    droppedEdges: number;
  } {
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      graph: this.exportJson(),
      droppedNodes: this.droppedNodes,
      droppedEdges: this.droppedEdges,
    };
  }

  restoreSnapshot(data: unknown): { droppedNodes: number; droppedEdges: number } {
    if (!data || typeof data !== 'object') return { droppedNodes: 0, droppedEdges: 0 };
    const snapshot = data as { schemaVersion?: number; graph?: EvidenceGraphSnapshot };
    if (snapshot.schemaVersion !== 1 || !snapshot.graph) {
      return { droppedNodes: 0, droppedEdges: 0 };
    }
    const { nodes, edges } = snapshot.graph;
    this.nodes.clear();
    this.edges.clear();
    this.outgoingEdgeIds.clear();
    this.incomingEdgeIds.clear();
    this.droppedNodes = 0;
    this.droppedEdges = 0;
    // Normal writes append monotonically-created nodes, so Map insertion order
    // is the eviction queue. A snapshot may be unordered; normalize it once on
    // restore instead of sorting the full graph on every capped write.
    for (const node of nodes.toSorted((a, b) => a.createdAt - b.createdAt)) {
      this.nodes.set(node.id, node);
    }
    for (const edge of edges) {
      this.edges.set(edge.id, edge);
      this.indexEdge(edge);
    }
    // Trim restored data back to the configured caps. A hostile or oversized
    // snapshot can inject more nodes/edges than the cap allows; without this
    // they would stay resident until the next add.
    this.evictOldestNodes();
    this.evictOldestEdges();
    // Re-seed the module-level ID counter from the restored ids. Without this a
    // restore into a fresh process (counter reset) would generate colliding ids
    // for new nodes/edges and silently overwrite restored Map entries.
    nextId = 1;
    const advanceCounter = (id: string): void => {
      const match = /\d+$/.exec(id);
      if (match) nextId = Math.max(nextId, Number(match[0]) + 1);
    };
    for (const node of nodes) advanceCounter(node.id);
    for (const edge of edges) advanceCounter(edge.id);
    this.mutationSeq = nodes.length + edges.length;
    this.lastPersistedSeq = this.mutationSeq;
    this.isDirty = false;
    // The evict calls above reset `droppedNodes`/`droppedEdges` to zero first,
    // so these counters reflect exactly what this restore trimmed away.
    return { droppedNodes: this.droppedNodes, droppedEdges: this.droppedEdges };
  }
}
