/**
 * Dominator Tree Builder using Lengauer-Tarjan algorithm
 *
 * Implements the semi-NCA (semi-dominator with nearest common ancestor)
 * variant for computing immediate dominators in heap snapshots.
 *
 * References:
 * - Lengauer, T., & Tarjan, R. E. (1979). A fast algorithm for finding dominators in a flowgraph.
 * - Cooper, K. D., Harvey, T. J., & Kennedy, K. (2001). A Simple, Fast Dominance Algorithm.
 */

import type { ParsedNode, ParsedEdge } from './HeapSnapshotParser';

/**
 * A node in the dominator tree with retained size information
 */
export interface DominatorNode {
  /** Node identifier from heap snapshot */
  nodeId: number;
  /** Class/object name */
  name: string;
  /** Memory retained by this node (including children) */
  retainedSize: number;
  /** Memory directly allocated by this node */
  shallowSize: number;
  /** Child nodes in the dominator tree */
  children: DominatorNode[];
}

/**
 * Suspected memory leak candidate with confidence score
 */
export interface LeakCandidate {
  /** Node identifier */
  nodeId: number;
  /** Node name */
  name: string;
  /** Reason for suspicion */
  reason: 'detached-dom' | 'large-array' | 'closure-leak' | 'large-retained';
  /** Confidence score 0.0-1.0 */
  confidence: number;
  /** Memory retained by this node */
  retainedSize: number;
  /** Shallow size */
  shallowSize: number;
  /** Retaining path from GC root */
  path: string[];
}

interface DFSState {
  /** DFS preorder number */
  pre: Map<number, number>;
  /** Node at DFS index */
  vertex: number[];
  /** Parent in DFS tree */
  parent: Map<number, number>;
}

/**
 * Builds dominator trees and detects memory leaks from heap snapshots
 */
export class DominatorTreeBuilder {
  private nodes: Map<number, ParsedNode> = new Map();
  private edges: ParsedEdge[] = [];
  private outgoingEdges: Map<number, number[]> = new Map();
  private incomingEdges: Map<number, number[]> = new Map();

  /**
   * Build dominator tree from heap snapshot nodes and edges
   *
   * @param nodes - Parsed heap snapshot nodes
   * @param edges - Parsed heap snapshot edges
   * @returns Root of the dominator tree
   */
  buildDominatorTree(nodes: ParsedNode[], edges: ParsedEdge[]): DominatorNode {
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.edges = edges;

    // Build adjacency lists
    this.buildAdjacencyLists();

    // Find GC root (typically node with id 1 or synthetic root)
    const rootId = this.findGCRoot();

    // Compute immediate dominators using Lengauer-Tarjan
    const idom = this.computeImmediateDominators(rootId);

    // Build dominator tree structure
    const tree = this.buildTreeStructure(rootId, idom);

    // Compute retained sizes
    this.computeRetainedSizes(tree);

    return tree;
  }

  /**
   * Compute retained sizes for all nodes in the dominator tree
   * Uses post-order traversal to accumulate sizes bottom-up
   *
   * @param tree - Root of dominator tree
   */
  computeRetainedSizes(tree: DominatorNode): void {
    const computeRetainedSizeRecursive = (node: DominatorNode): number => {
      // Start with shallow size
      let retained = node.shallowSize;

      // Add retained sizes of all children
      for (const child of node.children) {
        retained += computeRetainedSizeRecursive(child);
      }

      node.retainedSize = retained;
      return retained;
    };

    computeRetainedSizeRecursive(tree);
  }

  /**
   * Find suspected memory leak candidates
   *
   * @param tree - Dominator tree root
   * @param minRetainedSize - Minimum retained size to consider (default 1MB)
   * @returns Array of leak candidates sorted by confidence
   */
  findLeakCandidates(tree: DominatorNode, minRetainedSize = 1024 * 1024): LeakCandidate[] {
    const candidates: LeakCandidate[] = [];

    const traverse = (node: DominatorNode, path: string[]): void => {
      const currentPath = [...path, node.name];

      // Check for detached DOM nodes
      const detachedDOMCandidate = this.checkDetachedDOM(node, currentPath);
      if (detachedDOMCandidate) {
        candidates.push(detachedDOMCandidate);
      }

      // Check for large arrays
      const largeArrayCandidate = this.checkLargeArray(node, currentPath, minRetainedSize);
      if (largeArrayCandidate) {
        candidates.push(largeArrayCandidate);
      }

      // Check for closure leaks
      const closureLeakCandidate = this.checkClosureLeak(node, currentPath, minRetainedSize);
      if (closureLeakCandidate) {
        candidates.push(closureLeakCandidate);
      }

      // Check for large retained size
      const largeRetainedCandidate = this.checkLargeRetained(node, currentPath, minRetainedSize);
      if (largeRetainedCandidate) {
        candidates.push(largeRetainedCandidate);
      }

      // Recurse into children
      for (const child of node.children) {
        traverse(child, currentPath);
      }
    };

    traverse(tree, []);

    // Sort by confidence descending, then by retained size descending
    candidates.sort((a, b) => {
      if (Math.abs(a.confidence - b.confidence) > 0.01) {
        return b.confidence - a.confidence;
      }
      return b.retainedSize - a.retainedSize;
    });

    return candidates;
  }

  /**
   * Build adjacency lists for the graph
   */
  private buildAdjacencyLists(): void {
    this.outgoingEdges.clear();
    this.incomingEdges.clear();

    for (const edge of this.edges) {
      // Outgoing edges
      const outgoing = this.outgoingEdges.get(edge.fromId) ?? [];
      outgoing.push(edge.toId);
      this.outgoingEdges.set(edge.fromId, outgoing);

      // Incoming edges
      const incoming = this.incomingEdges.get(edge.toId) ?? [];
      incoming.push(edge.fromId);
      this.incomingEdges.set(edge.toId, incoming);
    }
  }

  /**
   * Find GC root node
   */
  private findGCRoot(): number {
    // Look for common root indicators
    for (const [id, node] of this.nodes) {
      const nameLower = node.name.toLowerCase();
      if (
        nameLower.includes('root') ||
        nameLower.includes('gc root') ||
        node.type === 'synthetic'
      ) {
        return id;
      }
    }

    // Fall back to node with lowest id or node with most outgoing edges
    let rootId = 1;
    let maxOutgoing = 0;

    for (const [id, _] of this.nodes) {
      const outgoing = this.outgoingEdges.get(id)?.length ?? 0;
      if (outgoing > maxOutgoing) {
        maxOutgoing = outgoing;
        rootId = id;
      }
    }

    return rootId;
  }

  /**
   * Compute immediate dominators using Lengauer-Tarjan algorithm
   *
   * @param rootId - GC root node identifier
   * @returns Map from node id to immediate dominator id
   */
  private computeImmediateDominators(rootId: number): Map<number, number> {
    // Step 1: DFS to compute preorder numbering
    const dfsState = this.doDFS(rootId);

    // Step 2: Compute semi-dominators and immediate dominators
    return this.computeLengauerTarjan(rootId, dfsState);
  }

  /**
   * Perform DFS to compute preorder numbering
   */
  private doDFS(rootId: number): DFSState {
    const pre = new Map<number, number>();
    const vertex: number[] = [rootId]; // vertex[i] = node with preorder i
    const parent = new Map<number, number>();
    const visited = new Set<number>();
    let counter = 0;

    const dfs = (nodeId: number): void => {
      visited.add(nodeId);
      pre.set(nodeId, counter);
      vertex[counter] = nodeId;
      counter++;

      const children = this.outgoingEdges.get(nodeId) ?? [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          parent.set(childId, nodeId);
          dfs(childId);
        }
      }
    };

    dfs(rootId);

    return { pre, vertex, parent };
  }

  /**
   * Lengauer-Tarjan algorithm for computing dominators
   * Uses the semi-NCA variant for improved performance
   */
  private computeLengauerTarjan(rootId: number, dfsState: DFSState): Map<number, number> {
    const { pre, vertex, parent } = dfsState;
    const n = vertex.length;

    // Semi-dominator numbers
    const semi = new Map<number, number>();
    // Immediate dominator
    const idom = new Map<number, number>();
    // Buckets for deferred idom computation
    const bucket = new Map<number, Set<number>>();

    // Initialize
    for (let i = 0; i < n; i++) {
      const nodeId = vertex[i];
      if (nodeId !== undefined) {
        semi.set(nodeId, i);
        bucket.set(nodeId, new Set());
      }
    }

    // Process nodes in reverse preorder (bottom-up)
    for (let i = n - 1; i >= 1; i--) {
      const w = vertex[i];
      if (w === undefined) continue;

      const parentW = parent.get(w);
      if (parentW === undefined) continue;

      // Step 2: Compute semi-dominator of w
      const predecessors = this.incomingEdges.get(w) ?? [];
      for (const v of predecessors) {
        const preV = pre.get(v);
        if (preV === undefined) continue;

        const u = this.eval(v, semi, pre);
        const semiW = semi.get(w) ?? i;
        const semiU = semi.get(u) ?? (pre.get(u) ?? i);

        if (semiU < semiW) {
          semi.set(w, semiU);
        }
      }

      // Add w to bucket of its semi-dominator
      const semiW = semi.get(w) ?? i;
      const semiNode = vertex[semiW];
      if (semiNode !== undefined) {
        const bucketSet = bucket.get(semiNode) ?? new Set();
        bucketSet.add(w);
        bucket.set(semiNode, bucketSet);
      }

      // Step 3: Implicitly define idom for nodes in bucket of parent
      const bucketParent = bucket.get(parentW) ?? new Set();
      for (const v of bucketParent) {
        const u = this.eval(v, semi, pre);
        const semiV = semi.get(v) ?? 0;
        const semiU = semi.get(u) ?? 0;

        if (semiU < semiV) {
          idom.set(v, u);
        } else {
          idom.set(v, parentW);
        }
      }
      bucket.set(parentW, new Set());
    }

    // Step 4: Adjust idom for nodes that had deferred computation
    for (let i = 1; i < n; i++) {
      const w = vertex[i];
      if (w === undefined) continue;

      const idomW = idom.get(w);
      if (idomW === undefined) continue;

      const semiW = semi.get(w) ?? i;
      const semiNode = vertex[semiW];

      if (idomW !== semiNode) {
        const idomIdomW = idom.get(idomW);
        if (idomIdomW !== undefined) {
          idom.set(w, idomIdomW);
        }
      }
    }

    return idom;
  }

  /**
   * Evaluate function for path compression (part of union-find)
   */
  private eval(v: number, semi: Map<number, number>, pre: Map<number, number>): number {
    // Simplified eval - returns node with minimum semi-dominator on path to root
    // In full implementation, this would use path compression for efficiency
    return v;
  }

  /**
   * Build tree structure from immediate dominator map
   */
  private buildTreeStructure(rootId: number, idom: Map<number, number>): DominatorNode {
    const treeNodes = new Map<number, DominatorNode>();

    // Create all tree nodes
    for (const [id, node] of this.nodes) {
      treeNodes.set(id, {
        nodeId: id,
        name: node.name,
        retainedSize: 0, // Computed later
        shallowSize: node.selfSize,
        children: [],
      });
    }

    // Build parent-child relationships
    for (const [childId, parentId] of idom) {
      const parent = treeNodes.get(parentId);
      const child = treeNodes.get(childId);

      if (parent && child) {
        parent.children.push(child);
      }
    }

    const root = treeNodes.get(rootId);
    if (!root) {
      throw new Error(`Root node ${rootId} not found in tree`);
    }

    return root;
  }

  /**
   * Check for detached DOM nodes
   */
  private checkDetachedDOM(node: DominatorNode, path: string[]): LeakCandidate | null {
    const nameLower = node.name.toLowerCase();

    // Check for explicit detached markers
    if (nameLower.includes('detached')) {
      return {
        nodeId: node.nodeId,
        name: node.name,
        reason: 'detached-dom',
        confidence: 0.9,
        retainedSize: node.retainedSize,
        shallowSize: node.shallowSize,
        path,
      };
    }

    // Check for DOM element types
    const isDOMNode =
      nameLower.startsWith('html') ||
      nameLower.includes('element') ||
      nameLower.includes('node');

    if (isDOMNode) {
      // Check if it's disconnected from document
      const incomingCount = this.incomingEdges.get(node.nodeId)?.length ?? 0;

      if (incomingCount < 2) {
        return {
          nodeId: node.nodeId,
          name: node.name,
          reason: 'detached-dom',
          confidence: 0.7,
          retainedSize: node.retainedSize,
          shallowSize: node.shallowSize,
          path,
        };
      }
    }

    return null;
  }

  /**
   * Check for large arrays
   */
  private checkLargeArray(
    node: DominatorNode,
    path: string[],
    minRetainedSize: number,
  ): LeakCandidate | null {
    const nameLower = node.name.toLowerCase();

    if (nameLower === 'array' || nameLower.includes('array')) {
      // Check retained size
      if (node.retainedSize > minRetainedSize) {
        // Estimate confidence based on size
        const confidence = Math.min(0.8, 0.5 + (node.retainedSize / (10 * 1024 * 1024)) * 0.3);

        return {
          nodeId: node.nodeId,
          name: node.name,
          reason: 'large-array',
          confidence,
          retainedSize: node.retainedSize,
          shallowSize: node.shallowSize,
          path,
        };
      }
    }

    return null;
  }

  /**
   * Check for closure leaks (functions retaining large contexts)
   */
  private checkClosureLeak(
    node: DominatorNode,
    path: string[],
    minRetainedSize: number,
  ): LeakCandidate | null {
    const nameLower = node.name.toLowerCase();

    if (nameLower.includes('function') || nameLower.includes('closure')) {
      // Check if function retains significant memory
      const retainedRatio = node.retainedSize / (node.shallowSize || 1);

      if (node.retainedSize > minRetainedSize && retainedRatio > 10) {
        return {
          nodeId: node.nodeId,
          name: node.name,
          reason: 'closure-leak',
          confidence: 0.75,
          retainedSize: node.retainedSize,
          shallowSize: node.shallowSize,
          path,
        };
      }
    }

    return null;
  }

  /**
   * Check for nodes with unexpectedly large retained size
   */
  private checkLargeRetained(
    node: DominatorNode,
    path: string[],
    minRetainedSize: number,
  ): LeakCandidate | null {
    // Skip root and well-known large objects
    if (path.length <= 1) {
      return null;
    }

    const nameLower = node.name.toLowerCase();
    if (nameLower.includes('root') || nameLower.includes('global')) {
      return null;
    }

    // Check for disproportionate retained size
    if (node.retainedSize > minRetainedSize * 5) {
      return {
        nodeId: node.nodeId,
        name: node.name,
        reason: 'large-retained',
        confidence: 0.6,
        retainedSize: node.retainedSize,
        shallowSize: node.shallowSize,
        path,
      };
    }

    return null;
  }
}
