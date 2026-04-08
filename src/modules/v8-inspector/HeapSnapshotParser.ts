interface ParsedNode {
  id: number;
  name: string;
  selfSize: number;
  type: string;
}

interface ParsedEdge {
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

function flattenLineRecords(value: unknown): number[][] {
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

function incrementCount(map: Map<number, number>, key: number): void {
  map.set(key, (map.get(key) ?? 0) + 1);
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

  constructor(private readonly snapshotData: string) {}

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

    const selfSizes = new Map<number, number>();
    const inboundCounts = new Map<number, number>();
    const ownedChildren = new Map<number, number[]>();

    for (const node of this.nodesCache) {
      selfSizes.set(node.id, node.selfSize);
      inboundCounts.set(node.id, 0);
    }

    for (const edge of this.edgesCache) {
      incrementCount(inboundCounts, edge.toId);
    }

    for (const edge of this.edgesCache) {
      if ((inboundCounts.get(edge.toId) ?? 0) !== 1) {
        continue;
      }
      const children = ownedChildren.get(edge.fromId) ?? [];
      children.push(edge.toId);
      ownedChildren.set(edge.fromId, children);
    }

    const memo = new Map<number, number>();
    const walk = (nodeId: number, trail: Set<number>): number => {
      const cached = memo.get(nodeId);
      if (cached !== undefined) {
        return cached;
      }
      if (trail.has(nodeId)) {
        return selfSizes.get(nodeId) ?? 0;
      }

      const nextTrail = new Set(trail);
      nextTrail.add(nodeId);

      let total = selfSizes.get(nodeId) ?? 0;
      const children = ownedChildren.get(nodeId) ?? [];
      for (const childId of children) {
        total += walk(childId, nextTrail);
      }

      memo.set(nodeId, total);
      return total;
    };

    for (const node of this.nodesCache) {
      walk(node.id, new Set<number>());
    }

    return memo;
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

  private ensureParsed(): void {
    if (this.parsed) {
      return;
    }

    const trimmed = this.snapshotData.trim();
    if (trimmed.length === 0) {
      this.parsed = true;
      return;
    }

    if (trimmed.startsWith('{')) {
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
          const typeIdx = record[1] ?? 0;
          const nameIdx = record[2] ?? 0;
          const id = record[3] ?? nodeIdsByIndex.length;
          const selfSize = record[4] ?? 0;

          const node: ParsedNode = {
            id,
            name: resolveNodeName(strings, nameIdx),
            selfSize,
            type: lookupTypeName(nodeTypes, typeIdx, 'node'),
          };

          this.nodesCache.push(node);
          nodeIdsByIndex.push(node.id);
          currentNodeId = node.id;
          continue;
        }

        if (tag === 1 && currentNodeId !== null) {
          const typeIdx = record[1] ?? 0;
          const nameOrIdx = record[2] ?? 0;
          const toNodeIdx = record[3] ?? 0;
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
