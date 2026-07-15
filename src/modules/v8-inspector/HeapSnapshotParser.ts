import { DominatorTreeBuilder, type DominatorNode } from './DominatorTreeBuilder';

export interface ParsedNode {
  id: number;
  name: string;
  selfSize: number;
  type: string;
}

export interface ParsedEdge {
  fromId: number;
  toId: number;
  nameOrIndex: string | number;
  type: string;
}

interface RetainerSummary {
  name: string;
  retainedSize: number;
  count: number;
}

/**
 * Class histogram entry for memory analysis
 */
export interface ClassHistogramEntry {
  className: string;
  count: number;
  shallowSize: number;
  retainedSize: number;
}

/**
 * Heap statistics summary
 */
export interface HeapStatistics {
  totalObjects: number;
  totalShallowSize: number;
  nodeCount: number;
  edgeCount: number;
  detachedDOMNodes: number;
}

/**
 * Complete heap analysis result
 */
export interface HeapAnalysisResult {
  classHistogram: ClassHistogramEntry[];
  dominatorTree?: {
    nodeId: number;
    name: string;
    retainedSize: number;
    shallowSize: number;
    children: DominatorNode[];
  };
  suspectedLeaks?: Array<{
    nodeId: number;
    name: string;
    reason: string;
    confidence: number;
    retainedSize: number;
    shallowSize: number;
    path: string[];
  }>;
  statistics: HeapStatistics;
  metadata: {
    snapshotId: string;
    parseTimeMs: number;
    version: string;
  };
}

interface HeapSnapshotDiff {
  added: ParsedNode[];
  removed: ParsedNode[];
  sizeDelta: number;
}

interface HeapSnapshotSummary {
  totalNodes: number;
  totalEdges: number;
  totalSize: number;
  topRetainers: RetainerSummary[];
}

interface SnapshotMetaLike {
  strings?: unknown;
  node_types?: unknown;
  edge_types?: unknown;
  snapshot?: unknown;
}

interface PendingLineEdge {
  fromId: number;
  toNodeIndex: number;
  nameOrIndex: string | number;
  type: string;
}

interface StandardNodeRecord {
  id: number;
  name: string;
  selfSize: number;
  type: string;
  edgeCount: number;
  offset: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Detect whether `data` is a v8 standard-format heap snapshot — a single JSON
 * object carrying a `snapshot.meta` record. Used by ensureParsed to pick the
 * right parser. We deliberately require the `snapshot` shape (not just "starts
 * with '{'") so NDJSON/line-format snapshots whose first line happens to open
 * a brace are not swallowed by the standard parser, and so multi-chunk
 * standard snapshots streamed in chunks are still recognized once feedChunk
 * re-joins them with no separator (the bug the old `!includes('\n')`
 * heuristic introduced — it gatekept standard format behind "no newlines",
 * which multi-chunk or pretty-printed input violated).
 *
 * Best-effort: a JSON parse failure means "not standard"; the caller falls
 * back to parseLineSnapshot, which tolerates per-line JSON.
 */
function looksLikeStandardSnapshot(data: string): boolean {
  // Quick reject: standard snapshots always start with '{' after trim.
  if (data.charCodeAt(0) !== 0x7b /* '{' */) return false;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return false;
  }
  if (!isRecord(value)) return false;
  const snapshot = value['snapshot'];
  if (!isRecord(snapshot)) return false;
  return isRecord(snapshot['meta']);
}
function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function isNestedNumberArray(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every((item) => isNumberArray(item));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is number => typeof item === 'number');
}

function firstNestedStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      const direct = toStringArray(item);
      if (direct.length > 0) {
        return direct;
      }
    }
  }
  return [];
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function flattenLineRecords(value: unknown): unknown[][] {
  if (Array.isArray(value)) {
    return [value];
  }
  if (isNumberArray(value)) {
    return [value];
  }
  if (isNestedNumberArray(value)) {
    return value;
  }
  if (isRecord(value)) {
    const data = value['data'];
    if (isNestedNumberArray(data)) {
      return data;
    }
    if (isNumberArray(data)) {
      return [data];
    }
    const records = value['records'];
    if (isNestedNumberArray(records)) {
      return records;
    }
    if (isNumberArray(records)) {
      return [records];
    }
  }
  return [];
}

function lookupTypeName(table: string[], index: number, fallbackPrefix: string): string {
  const typeName = table[index];
  if (typeof typeName === 'string' && typeName.length > 0) {
    return typeName;
  }
  return `${fallbackPrefix}_${index}`;
}

function resolveNodeName(strings: string[], index: number): string {
  const candidate = strings[index];
  if (typeof candidate === 'string') {
    return candidate;
  }
  return String(index);
}

function resolveEdgeName(strings: string[], edgeType: string, value: number): string | number {
  if (edgeType === 'element' || edgeType === 'hidden') {
    return value;
  }
  const candidate = strings[value];
  if (typeof candidate === 'string') {
    return candidate;
  }
  return value;
}

function nodeKey(node: ParsedNode): string {
  return `${node.type}\u0000${node.name}\u0000${node.selfSize}`;
}

function parseSnapshotMeta(meta: SnapshotMetaLike): {
  strings: string[];
  nodeTypes: string[];
  edgeTypes: string[];
} {
  const strings = toStringArray(meta.strings);
  let nodeTypes = firstNestedStringArray(meta.node_types);
  let edgeTypes = firstNestedStringArray(meta.edge_types);

  const snapshotValue = meta.snapshot;
  if (isRecord(snapshotValue)) {
    if (nodeTypes.length === 0) {
      nodeTypes = firstNestedStringArray(snapshotValue['node_types']);
    }
    if (edgeTypes.length === 0) {
      edgeTypes = firstNestedStringArray(snapshotValue['edge_types']);
    }

    const metaValue = snapshotValue['meta'];
    if (isRecord(metaValue)) {
      if (nodeTypes.length === 0) {
        nodeTypes = firstNestedStringArray(metaValue['node_types']);
      }
      if (edgeTypes.length === 0) {
        edgeTypes = firstNestedStringArray(metaValue['edge_types']);
      }
    }
  }

  return { strings, nodeTypes, edgeTypes };
}

export class HeapSnapshotParser {
  private parsed = false;
  private nodesCache: ParsedNode[] = [];
  private edgesCache: ParsedEdge[] = [];
  private chunkBuffer: string[] = [];

  constructor(private snapshotData = '') {}

  feedChunk(chunks: string[]): void {
    if (this.parsed) {
      throw new Error('Heap snapshot already parsed');
    }

    for (const chunk of chunks) {
      if (typeof chunk === 'string' && chunk.length > 0) {
        this.chunkBuffer.push(chunk);
      }
    }

    // Standard V8 heap snapshots are one continuous JSON document streamed
    // in chunks; concatenation must NOT insert separators (the previous '\n'
    // join corrupted any standard snapshot split across chunks — the joined
    // string was no longer valid JSON, so format detection and parsing both
    // silently produced zero nodes). Empty-string join restores the original
    // byte stream. Line-format (NDJSON) snapshots are routed via
    // looksLikeStandardSnapshot() in ensureParsed, not via feedChunk wiring.
    this.snapshotData = this.chunkBuffer.join('');
    this.ensureParsed();
  }

  get nodeCount(): number {
    this.ensureParsed();
    return this.nodesCache.length;
  }

  getAllNodes(): ParsedNode[] {
    return this.parseNodes();
  }

  getNodesByClassName(className: string): ParsedNode[] {
    return this.parseNodes().filter((node) => node.name === className);
  }

  getObjectsByType(type: string): ParsedNode[] {
    return this.parseNodes().filter((node) => node.type === type);
  }

  buildDominatorTree(): Map<number, number> {
    return this.computeRetainedSizes();
  }

  getAllRetainedSizes(): Array<{ id: number; retainedSize: number }> {
    return Array.from(this.computeRetainedSizes().entries()).map(([id, retainedSize]) => ({
      id,
      retainedSize,
    }));
  }

  parseNodes(): ParsedNode[] {
    this.ensureParsed();
    return [...this.nodesCache];
  }

  parseEdges(): ParsedEdge[] {
    this.ensureParsed();
    return [...this.edgesCache];
  }

  computeRetainedSizes(): Map<number, number> {
    this.ensureParsed();
    const retainedSizes = new Map(this.nodesCache.map((node) => [node.id, node.selfSize]));
    if (this.nodesCache.length === 0) return retainedSizes;

    const tree = new DominatorTreeBuilder().buildDominatorTree(this.nodesCache, this.edgesCache);
    const pending = [tree];
    while (pending.length > 0) {
      const node = pending.pop();
      if (!node) continue;
      retainedSizes.set(node.nodeId, node.retainedSize);
      pending.push(...node.children);
    }
    return retainedSizes;
  }

  getTopRetainers(n: number = 10): RetainerSummary[] {
    this.ensureParsed();

    const grouped = new Map<string, RetainerSummary>();
    for (const node of this.nodesCache) {
      const current = grouped.get(node.name);
      if (current) {
        current.retainedSize += node.selfSize;
        current.count += 1;
        continue;
      }
      grouped.set(node.name, {
        name: node.name,
        retainedSize: node.selfSize,
        count: 1,
      });
    }

    return [...grouped.values()]
      .toSorted((left, right) => right.retainedSize - left.retainedSize || right.count - left.count)
      .slice(0, n);
  }

  diff(other: HeapSnapshotParser): HeapSnapshotDiff {
    const currentNodes = this.parseNodes();
    const otherNodes = other.parseNodes();

    const currentCounts = new Map<string, ParsedNode[]>();
    const otherCounts = new Map<string, ParsedNode[]>();

    for (const node of currentNodes) {
      const key = nodeKey(node);
      const bucket = currentCounts.get(key) ?? [];
      bucket.push(node);
      currentCounts.set(key, bucket);
    }

    for (const node of otherNodes) {
      const key = nodeKey(node);
      const bucket = otherCounts.get(key) ?? [];
      bucket.push(node);
      otherCounts.set(key, bucket);
    }

    const allKeys = new Set<string>([...currentCounts.keys(), ...otherCounts.keys()]);
    const added: ParsedNode[] = [];
    const removed: ParsedNode[] = [];

    for (const key of allKeys) {
      const currentBucket = currentCounts.get(key) ?? [];
      const otherBucket = otherCounts.get(key) ?? [];

      if (currentBucket.length > otherBucket.length) {
        added.push(...currentBucket.slice(otherBucket.length));
      } else if (otherBucket.length > currentBucket.length) {
        removed.push(...otherBucket.slice(currentBucket.length));
      }
    }

    const currentSize = currentNodes.reduce((total, node) => total + node.selfSize, 0);
    const otherSize = otherNodes.reduce((total, node) => total + node.selfSize, 0);

    return {
      added,
      removed,
      sizeDelta: currentSize - otherSize,
    };
  }

  exportSummary(): HeapSnapshotSummary {
    this.ensureParsed();
    const totalSize = this.nodesCache.reduce((total, node) => total + node.selfSize, 0);
    return {
      totalNodes: this.nodesCache.length,
      totalEdges: this.edgesCache.length,
      totalSize,
      topRetainers: this.getTopRetainers(),
    };
  }

  /**
   * Generate a complete heap analysis including class histogram and statistics.
   * Phase 2 implementation: Includes dominator tree and leak detection.
   *
   * @param snapshotId - Identifier for this snapshot
   * @param options - Analysis options
   * @returns Complete analysis result with histogram, statistics, dominator tree, and leak detection
   */
  async analyzeHeap(
    snapshotId: string,
    options?: {
      includeDominatorTree?: boolean;
      dominatorTreeDepth?: number;
      includeLeakDetection?: boolean;
      minLeakSize?: number;
    },
  ): Promise<HeapAnalysisResult> {
    const startTime = Date.now();
    this.ensureParsed();

    const {
      includeDominatorTree = false,
      dominatorTreeDepth = 3,
      includeLeakDetection = false,
      minLeakSize = 1024 * 1024,
    } = options ?? {};

    // Build class histogram
    const histogramMap = new Map<
      string,
      { count: number; shallowSize: number; retainedSize: number }
    >();

    for (const node of this.nodesCache) {
      const className = node.name || `(${node.type})`;
      const existing = histogramMap.get(className);

      if (existing) {
        existing.count += 1;
        existing.shallowSize += node.selfSize;
        existing.retainedSize += node.selfSize; // Updated by dominator tree if enabled
      } else {
        histogramMap.set(className, {
          count: 1,
          shallowSize: node.selfSize,
          retainedSize: node.selfSize,
        });
      }
    }

    // Convert to sorted array
    const classHistogram: ClassHistogramEntry[] = [];
    for (const [className, stats] of histogramMap.entries()) {
      classHistogram.push({
        className,
        count: stats.count,
        shallowSize: stats.shallowSize,
        retainedSize: stats.retainedSize,
      });
    }

    // Sort by retained size descending
    classHistogram.sort((a, b) => b.retainedSize - a.retainedSize);

    // Build dominator tree if requested
    let dominatorTree: HeapAnalysisResult['dominatorTree'];
    let suspectedLeaks: HeapAnalysisResult['suspectedLeaks'];

    if (includeDominatorTree || includeLeakDetection) {
      try {
        const builder = new DominatorTreeBuilder();

        const fullTree = builder.buildDominatorTree(this.nodesCache, this.edgesCache);

        if (includeDominatorTree) {
          // Truncate tree to specified depth
          dominatorTree = this.truncateTree(fullTree, dominatorTreeDepth);
        }

        if (includeLeakDetection) {
          const leakCandidates = builder.findLeakCandidates(fullTree, minLeakSize);
          suspectedLeaks = leakCandidates.map((leak) => ({
            nodeId: leak.nodeId,
            name: leak.name,
            reason: leak.reason,
            confidence: leak.confidence,
            retainedSize: leak.retainedSize,
            shallowSize: leak.shallowSize,
            path: leak.path,
          }));
        }
      } catch (error) {
        // Gracefully degrade if dominator tree computation fails
        console.warn('Failed to compute dominator tree:', error);
      }
    }

    // Compute statistics
    const totalObjects = this.nodesCache.length;
    const totalShallowSize = this.nodesCache.reduce((sum, node) => sum + node.selfSize, 0);
    const detachedDOMNodes = this.countDetachedDOMNodes();

    const parseTimeMs = Date.now() - startTime;

    const result: HeapAnalysisResult = {
      classHistogram,
      statistics: {
        totalObjects,
        totalShallowSize,
        nodeCount: totalObjects,
        edgeCount: this.edgesCache.length,
        detachedDOMNodes,
      },
      metadata: {
        snapshotId,
        parseTimeMs,
        version: includeDominatorTree || includeLeakDetection ? '2.0.0-phase2' : '1.0.0-phase1',
      },
    };

    if (dominatorTree !== undefined) {
      result.dominatorTree = dominatorTree;
    }

    if (suspectedLeaks !== undefined) {
      result.suspectedLeaks = suspectedLeaks;
    }

    return result;
  }

  /**
   * Truncate dominator tree to specified depth
   */
  private truncateTree(
    node: DominatorNode,
    maxDepth: number,
    currentDepth = 0,
  ): NonNullable<HeapAnalysisResult['dominatorTree']> {
    if (currentDepth >= maxDepth) {
      return {
        nodeId: node.nodeId,
        name: node.name,
        retainedSize: node.retainedSize,
        shallowSize: node.shallowSize,
        children: [], // Truncate children
      };
    }

    return {
      nodeId: node.nodeId,
      name: node.name,
      retainedSize: node.retainedSize,
      shallowSize: node.shallowSize,
      children: node.children.map((child) => this.truncateTree(child, maxDepth, currentDepth + 1)),
    };
  }

  /**
   * Count detached DOM nodes using heuristics.
   * Detects nodes with "detached" in name or DOM element types with low connectivity.
   */
  private countDetachedDOMNodes(): number {
    let count = 0;

    for (const node of this.nodesCache) {
      const nameLower = node.name.toLowerCase();

      // Check for explicit "detached" marker
      if (nameLower.includes('detached')) {
        count += 1;
        continue;
      }

      // Check for DOM node types
      const isDOMNodeType =
        nameLower.startsWith('html') ||
        nameLower.includes('element') ||
        (nameLower.includes('node') && !nameLower.includes('function'));

      if (isDOMNodeType) {
        // Count incoming edges
        const incomingCount = this.edgesCache.filter((edge) => edge.toId === node.id).length;

        // Heuristic: DOM nodes with very few incoming edges are likely detached
        if (incomingCount < 2) {
          count += 1;
        }
      }
    }

    return count;
  }

  private ensureParsed(): void {
    if (this.parsed) {
      return;
    }

    const trimmed = this.snapshotData.trim();
    if (trimmed.length === 0) {
      this.parsed = true;
      return;
    }

    // Format detection. The previous heuristic (`startsWith('{') && !includes('\n')`)
    // misrouted multi-chunk standard-JSON snapshots to parseLineSnapshot:
    // feedChunk joins chunks with '\n', so any standard snapshot whose JSON
    // spans more than one chunk (or contains newlines) gained a '\n' and was
    // treated as line format — silently producing zero/wrong nodes.
    //
    // Robust approach: try standard JSON first (it parses as a single object
    // with a `snapshot` field). Only when that fails do we fall through to the
    // line/NDJSON format. Order matters: a line-format blob whose first line
    // happens to start with '{' would still go to standard first, but
    // parseStandardSnapshot guards on the `snapshot` + `meta` shape and
    // returns without writing anything if absent — so the fallback below
    // re-runs it as line format. To make that fallback safe, only treat data
    // as standard when it really looks like a v8 heap snapshot object.
    if (looksLikeStandardSnapshot(trimmed)) {
      this.parseStandardSnapshot(trimmed);
    } else {
      this.parseLineSnapshot(trimmed);
    }

    this.parsed = true;
  }

  private parseLineSnapshot(snapshotText: string): void {
    const lines = snapshotText
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return;
    }

    const firstLine = lines[0];
    if (!firstLine) {
      return;
    }

    const metaValue = parseJsonLine(firstLine);
    const meta = isRecord(metaValue) ? metaValue : {};
    const { strings, nodeTypes, edgeTypes } = parseSnapshotMeta(meta);

    const nodeIdsByIndex: number[] = [];
    const pendingEdges: PendingLineEdge[] = [];
    let currentNodeId: number | null = null;

    for (const line of lines.slice(1)) {
      const parsedLine = parseJsonLine(line);
      const records = flattenLineRecords(parsedLine);

      for (const record of records) {
        const tag = record[0];
        if (tag === 0) {
          const compactRecord = typeof record[1] === 'string';
          const typeIdx = compactRecord ? 0 : typeof record[1] === 'number' ? record[1] : 0;
          const nameValue = compactRecord ? record[1] : record[2];
          const idValue = compactRecord ? record[2] : record[3];
          const selfSizeValue = compactRecord ? record[3] : record[4];
          const id = typeof idValue === 'number' ? idValue : nodeIdsByIndex.length;
          const selfSize = typeof selfSizeValue === 'number' ? selfSizeValue : 0;

          const resolvedName =
            typeof nameValue === 'string'
              ? nameValue
              : resolveNodeName(strings, typeof nameValue === 'number' ? nameValue : 0);

          const node: ParsedNode = {
            id,
            name: resolvedName,
            selfSize,
            type: lookupTypeName(nodeTypes, typeIdx, 'node'),
          };

          this.nodesCache.push(node);
          nodeIdsByIndex.push(node.id);
          currentNodeId = node.id;
          continue;
        }

        if (tag === 1 && currentNodeId !== null) {
          const typeIdx = typeof record[1] === 'number' ? record[1] : 0;
          const nameOrIdx = record[2] ?? 0;
          const toNodeIdx = typeof record[3] === 'number' ? record[3] : 0;
          const edgeType = lookupTypeName(edgeTypes, typeIdx, 'edge');

          pendingEdges.push({
            fromId: currentNodeId,
            toNodeIndex: toNodeIdx,
            nameOrIndex:
              typeof nameOrIdx === 'number'
                ? resolveEdgeName(strings, edgeType, nameOrIdx)
                : String(nameOrIdx),
            type: edgeType,
          });
        }
      }
    }

    for (const edge of pendingEdges) {
      const resolvedTarget = nodeIdsByIndex[edge.toNodeIndex];
      this.edgesCache.push({
        fromId: edge.fromId,
        toId: resolvedTarget ?? edge.toNodeIndex,
        nameOrIndex: edge.nameOrIndex,
        type: edge.type,
      });
    }
  }

  private parseStandardSnapshot(snapshotText: string): void {
    const parsed = parseJsonLine(snapshotText);
    if (!isRecord(parsed)) {
      return;
    }

    const strings = toStringArray(parsed['strings']);
    const nodes = toNumberArray(parsed['nodes']);
    const edges = toNumberArray(parsed['edges']);
    const snapshot = parsed['snapshot'];

    if (!isRecord(snapshot)) {
      return;
    }

    const metaValue = snapshot['meta'];
    if (!isRecord(metaValue)) {
      return;
    }

    const nodeFields = toStringArray(metaValue['node_fields']);
    const edgeFields = toStringArray(metaValue['edge_fields']);
    const nodeTypes = firstNestedStringArray(metaValue['node_types']);
    const edgeTypes = firstNestedStringArray(metaValue['edge_types']);

    if (nodeFields.length === 0 || edgeFields.length === 0) {
      return;
    }

    const nodeStride = nodeFields.length;
    const edgeStride = edgeFields.length;
    const typeIndex = nodeFields.indexOf('type');
    const nameIndex = nodeFields.indexOf('name');
    const idIndex = nodeFields.indexOf('id');
    const selfSizeIndex = nodeFields.indexOf('self_size');
    const edgeCountIndex = nodeFields.indexOf('edge_count');
    const edgeTypeIndex = edgeFields.indexOf('type');
    const edgeNameIndex = edgeFields.indexOf('name_or_index');
    const edgeTargetIndex = edgeFields.indexOf('to_node');

    if (
      typeIndex < 0 ||
      nameIndex < 0 ||
      idIndex < 0 ||
      selfSizeIndex < 0 ||
      edgeCountIndex < 0 ||
      edgeTypeIndex < 0 ||
      edgeNameIndex < 0 ||
      edgeTargetIndex < 0
    ) {
      return;
    }

    const nodeRecords: StandardNodeRecord[] = [];
    const offsetToNodeId = new Map<number, number>();

    for (let offset = 0; offset + nodeStride <= nodes.length; offset += nodeStride) {
      const typeIdx = nodes[offset + typeIndex] ?? 0;
      const nameIdx = nodes[offset + nameIndex] ?? 0;
      const id = nodes[offset + idIndex] ?? offset / nodeStride;
      const selfSize = nodes[offset + selfSizeIndex] ?? 0;
      const edgeCount = nodes[offset + edgeCountIndex] ?? 0;

      const record: StandardNodeRecord = {
        id,
        name: resolveNodeName(strings, nameIdx),
        selfSize,
        type: lookupTypeName(nodeTypes, typeIdx, 'node'),
        edgeCount,
        offset,
      };

      nodeRecords.push(record);
      offsetToNodeId.set(offset, record.id);
      this.nodesCache.push({
        id: record.id,
        name: record.name,
        selfSize: record.selfSize,
        type: record.type,
      });
    }

    let edgeOffset = 0;
    for (const node of nodeRecords) {
      for (let index = 0; index < node.edgeCount; index += 1) {
        if (edgeOffset + edgeStride > edges.length) {
          return;
        }

        const typeIdx = edges[edgeOffset + edgeTypeIndex] ?? 0;
        const nameOrIndex = edges[edgeOffset + edgeNameIndex] ?? 0;
        const toNodeOffset = edges[edgeOffset + edgeTargetIndex] ?? 0;
        const edgeType = lookupTypeName(edgeTypes, typeIdx, 'edge');

        this.edgesCache.push({
          fromId: node.id,
          toId: offsetToNodeId.get(toNodeOffset) ?? toNodeOffset,
          nameOrIndex: resolveEdgeName(strings, edgeType, nameOrIndex),
          type: edgeType,
        });

        edgeOffset += edgeStride;
      }
    }
  }
}
