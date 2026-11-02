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
 * Compute retained size for a single node.
 * Iterative post-order (explicit stack) — a recursive version overflows the
 * call stack on deep dominator chains (10k+ nodes in large heap snapshots).
 * Moved to module scope since it doesn't capture any outer scope variables.
 */
function computeRetainedSizeRecursive(node: DominatorNode): number {
  const order: DominatorNode[] = [];
  const stack: DominatorNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    order.push(cur);
    stack.push(...cur.children);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const cur = order[i]!;
    cur.retainedSize =
      cur.shallowSize + cur.children.reduce((sum, child) => sum + child.retainedSize, 0);
  }
  return node.retainedSize;
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

/** State of the link-eval forest used by the semi-NCA variant. */
interface LinkEvalForest {
  /** ancestor[v] is v's forest parent; 0 is the "no ancestor" sentinel. */
  ancestor: Map<number, number>;
  /** label[v] is the min-semi vertex on the compressed path from v upward. */
  label: Map<number, number>;
  /** semi[v] is v's semi-dominator DFS number. */
  semi: Map<number, number>;
  /** Number of DFS-reachable vertices, used as the "infinity" semi value. */
  n: number;
}

/**
 * compress(v): flatten the path from v up to its forest root and copy the
 * minimum-semi label downward so label[v] becomes the minimum-semi ancestor on
 * the (now compressed) path.
 */
function compressLinkEval(forest: LinkEvalForest, v: number): void {
  const { ancestor, label, semi, n } = forest;
  const av = ancestor.get(v) ?? 0;
  const aav = ancestor.get(av) ?? 0;
  if (av === 0 || aav === 0) return;
  // Recurse first so the parent path is already compressed.
  compressLinkEval(forest, av);
  // Compare against the parent's label — after the recursion, label[av] is the
  // min-semi vertex on the path av→root, so this propagates the path minimum
  // into label[v]. (Previously compared label[aav] against label[av], which is
  // always false since av→root ⊇ aav→root, so label[v] was never updated —
  // wrong idom on graphs with cross edges.)
  if ((semi.get(label.get(av) ?? av) ?? n) < (semi.get(label.get(v) ?? v) ?? n)) {
    label.set(v, label.get(av) ?? av);
  }
  ancestor.set(v, ancestor.get(av) ?? 0);
}

/**
 * eval(v): return the vertex on the compressed path from v to its forest root
 * whose semi-dominator is minimum — the heart of LT. With ancestor[v] = 0
 * (root) the answer is label[v] = v itself, reproducing the trivial-graph
 * behavior the previous stub relied on, but correct for any graph with
 * cross/forward edges once link()/compress() populate ancestor.
 */
function evalLinkEval(forest: LinkEvalForest, v: number): number {
  const { ancestor, label, semi, n } = forest;
  if ((ancestor.get(v) ?? 0) === 0) {
    return label.get(v) ?? v;
  }
  compressLinkEval(forest, v);
  const av = ancestor.get(v) ?? 0;
  const labelV = label.get(v) ?? v;
  const labelAv = label.get(av) ?? av;
  if ((semi.get(labelAv) ?? n) <= (semi.get(labelV) ?? n)) {
    return labelAv;
  }
  return labelV;
}

/** Inputs for the Step-2 semi-dominator computation. */
interface SemiDominatorStep {
  /** Vertex being processed. */
  w: number;
  /** Its DFS index, used as the fallback semi value. */
  i: number;
  /** Incoming edges of `w`. */
  predecessors: readonly number[];
  pre: Map<number, number>;
  vertex: number[];
  semi: Map<number, number>;
  bucket: Map<number, Set<number>>;
  evalLT: (v: number) => number;
}

/**
 * Step 2 of Lengauer-Tarjan: lower `semi[w]` to the smallest semi-dominator
 * reachable from any predecessor, then file `w` under that semi-dominator's
 * bucket for later idom resolution.
 */
function computeSemiDominator(step: SemiDominatorStep): void {
  const { w, i, predecessors, pre, vertex, semi, bucket, evalLT } = step;

  for (const v of predecessors) {
    const preV = pre.get(v);
    if (preV === undefined) continue;

    const u = evalLT(v);
    const semiW = semi.get(w) ?? i;
    const semiU = semi.get(u) ?? pre.get(u) ?? i;

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
}

/**
 * Step 3 of Lengauer-Tarjan: resolve idom for everything parked in the bucket
 * of `parentW`, then empty that bucket.
 *
 * `idom` is the local result map; `sharedIdom` is the instance copy that other
 * methods read, so both must be written together.
 */
function resolveBucketForParent(
  parentW: number,
  semi: Map<number, number>,
  bucket: Map<number, Set<number>>,
  idom: Map<number, number>,
  sharedIdom: Map<number, number>,
  evalLT: (v: number) => number,
): void {
  const bucketParent = bucket.get(parentW) ?? new Set();
  for (const v of bucketParent) {
    const u = evalLT(v);
    const semiV = semi.get(v) ?? 0;
    const semiU = semi.get(u) ?? 0;

    if (semiU < semiV) {
      idom.set(v, u);
      sharedIdom.set(v, u);
    } else {
      idom.set(v, parentW);
      sharedIdom.set(v, parentW);
    }
  }
  bucket.set(parentW, new Set());
}

/**
 * Builds dominator trees and detects memory leaks from heap snapshots
 */
export class DominatorTreeBuilder {
  private nodes: Map<number, ParsedNode> = new Map();
  private edges: ParsedEdge[] = [];
  private outgoingEdges: Map<number, number[]> = new Map();
  private incomingEdges: Map<number, number[]> = new Map();
  private idom: Map<number, number> = new Map();

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
  private computeLengauerTarjan(_rootId: number, dfsState: DFSState): Map<number, number> {
    const { pre, vertex, parent } = dfsState;
    const n = vertex.length;

    // Semi-dominator numbers
    const semi = new Map<number, number>();
    // Immediate dominator
    const idom = new Map<number, number>();
    // Buckets for deferred idom computation
    const bucket = new Map<number, Set<number>>();

    // ── Link-eval forest (union-find with path compression) ──────────────────
    // SemiNCA / near-linear Lengauer-Tarjan variant (Georgiadis 2006):
    // ancestor[v] is v's forest parent (0 sentinel ⇒ tree root); label[v] is
    // the vertex with minimum semi-dominator on the compressed path from v to
    // its forest root. link() does a plain attach (no size balancing); compress()
    // flattens the ancestor chain and copies the min-semi label downward. With
    // plain link + compress this is O(m α(n)) — more than fast enough for the
    // 10k-node perf test, and dramatically simpler/better-tested than the
    // balanced-link variant. The previous stub `return v` produced WRONG idom
    // maps on any graph with cross/forward edges (semi-dominator of w was
    // never computed from min-semi ancestors, only from semi[w] itself).
    const ancestor = new Map<number, number>();
    const label = new Map<number, number>();

    // Initialize every DFS-reachable node. label[v] starts as v itself — the
    // invariant is that label[v] is the minimum-semi vertex on the path from
    // v to ancestor[v]; with ancestor[v] = 0 (root), the path is just {v}.
    for (let i = 0; i < n; i++) {
      const nodeId = vertex[i];
      if (nodeId !== undefined) {
        semi.set(nodeId, i);
        label.set(nodeId, nodeId);
        ancestor.set(nodeId, 0); // 0 = sentinel "no ancestor"
        bucket.set(nodeId, new Set());
      }
    }

    // link(v, w): attach w's tree under v. Called after w is fully processed
    // (reverse-preorder iteration), making v the forest parent of w. Plain
    // attach — no rebalancing; path compression in compress() handles the
    // amortized complexity.
    const link = (v: number, w: number): void => {
      ancestor.set(w, v);
    };

    const forest: LinkEvalForest = { ancestor, label, semi, n };

    // eval(v): return the vertex on the compressed path from v to its forest
    // root whose semi-dominator is minimum — the heart of LT. `compress` runs
    // inside evalLinkEval, so the compression side effect happens here exactly
    // as it did when both lived in this scope.
    const evalLT = (v: number): number => evalLinkEval(forest, v);

    // Process nodes in reverse preorder (bottom-up)
    for (let i = n - 1; i >= 1; i--) {
      const w = vertex[i];
      if (w === undefined) continue;

      const parentW = parent.get(w);
      if (parentW === undefined) continue;

      // Step 2: Compute semi-dominator of w, then file w under that
      // semi-dominator's bucket.
      computeSemiDominator({
        w,
        i,
        predecessors: this.incomingEdges.get(w) ?? [],
        pre,
        vertex,
        semi,
        bucket,
        evalLT,
      });

      // Step 3: Implicitly define idom for nodes in bucket of parent.
      // w's processing is done, so link parentW → w in the eval forest before
      // reading the bucket so later eval() calls through w see the new edge.
      link(parentW, w);
      resolveBucketForParent(parentW, semi, bucket, idom, this.idom, evalLT);
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
          this.idom.set(w, idomIdomW);
        }
      }
    }

    return idom;
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
      nameLower.startsWith('html') || nameLower.includes('element') || nameLower.includes('node');

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

  /**
   * Walk from a leaf node back to the GC root through immediate dominators,
   * returning a chain of (nodeId, name, className, shallowSize, retainedSize)
   * objects from leaf to root.  This is the "what keeps it alive" retainer path.
   *
   * @param nodeId - Leaf node id to trace from
   * @param maxSteps - Maximum steps before giving up (default: 50)
   * @returns Array of retainer chain entries (leaf first, GC root last)
   */
  getRetainerChain(
    nodeId: number,
    maxSteps: number = 50,
  ): Array<{
    nodeId: number;
    name: string;
    className: string;
    shallowSize: number;
    retainedSize: number;
    distance: number;
  }> {
    const chain: Array<{
      nodeId: number;
      name: string;
      className: string;
      shallowSize: number;
      retainedSize: number;
      distance: number;
    }> = [];

    let current = nodeId;
    let dist = 0;

    while (current !== 0 && dist < maxSteps) {
      const node = this.nodes.get(current);
      if (!node) break;

      chain.push({
        nodeId: node.id,
        name: node.name,
        className: (node as { className?: string }).className ?? node.type ?? 'unknown',
        shallowSize: (node as { shallowSize?: number }).shallowSize ?? node.selfSize,
        retainedSize: (node as { retainedSize?: number }).retainedSize ?? node.selfSize,
        distance: dist,
      });

      // Walk to immediate dominator
      const parentId = this.idom.get(current);
      if (parentId === undefined || parentId === current) break;
      current = parentId;
      dist++;
    }

    return chain;
  }

  /**
   * Batch version of getRetainerChain — traces retainer paths for multiple nodes.
   */
  getRetainerChains(
    nodeIds: number[],
    maxSteps: number = 50,
  ): Record<number, ReturnType<DominatorTreeBuilder['getRetainerChain']>> {
    const result: Record<number, ReturnType<DominatorTreeBuilder['getRetainerChain']>> = {};
    for (const id of nodeIds) {
      result[id] = this.getRetainerChain(id, maxSteps);
    }
    return result;
  }

  /**
   * Find all heap objects retained by functions matching a given name pattern.
   * Walks the dominator tree from the GC root, collecting nodes whose name
   * matches the pattern, then returns their retainer chains.
   *
   * @param pattern - Substring to match against node names (case-insensitive)
   * @param tree - Dominator tree root
   * @param maxResults - Maximum number of results (default: 50)
   * @param minRetainedSize - Minimum retained size filter (default: 0)
   * @returns Array of matching nodes with retainer chains
   */
  getRetainedByFunctionName(
    pattern: string,
    tree: DominatorNode,
    maxResults: number = 50,
    minRetainedSize: number = 0,
  ): Array<{
    nodeId: number;
    name: string;
    retainedSize: number;
    shallowSize: number;
    retainerChain: Array<{
      nodeId: number;
      name: string;
      className: string;
      shallowSize: number;
      retainedSize: number;
      distance: number;
    }>;
    children: number;
  }> {
    const patternLower = pattern.toLowerCase();
    const matches: Array<{ node: DominatorNode }> = [];

    const traverse = (node: DominatorNode): void => {
      const nameLower = node.name.toLowerCase();
      if (nameLower.includes(patternLower) && node.retainedSize >= minRetainedSize) {
        matches.push({ node });
      }
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(tree);

    // Sort by retained size descending
    matches.sort((a, b) => b.node.retainedSize - a.node.retainedSize);

    return matches.slice(0, maxResults).map(({ node }) => ({
      nodeId: node.nodeId,
      name: node.name,
      retainedSize: node.retainedSize,
      shallowSize: node.shallowSize,
      retainerChain: this.getRetainerChain(node.nodeId, 50),
      children: node.children.length,
    }));
  }
}
