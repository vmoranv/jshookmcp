/**
 * TurboFan IR Graph Parser
 *
 * Parses V8 --trace-turbo JSON output files into structured TypeScript objects.
 * The JSON format is produced by V8's turbofan-graph-visualizer.cc and consumed
 * by Turbolizer. We parse the subset needed for programmatic inspection:
 *   - Function metadata (name, source position, inlined sources)
 *   - Per-phase graph data (nodes + edges with typedIntermediateRepresentation)
 *   - Schedule data (basic blocks + instruction ordering)
 *   - Register allocation data
 *
 * @module TurboFanGraphParser
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TurboFanFunctionMeta {
  sourceId: number;
  functionName: string;
  sourceName: string;
  sourceText: string;
  startPosition: number;
  endPosition: number;
}

export interface TurboFanInliningEntry {
  inliningId: number;
  sourceId: number;
  inliningPosition: Record<string, unknown>;
}

export interface TurboFanNode {
  id: number;
  label: string;
  title: string;
  live: boolean;
  properties: string;
  opcode: string;
  control: boolean;
  opinfo: string;
  type: string;
  sourcePosition?: Record<string, unknown>;
  origin?: Record<string, unknown>;
}

export type TurboFanEdgeType =
  | 'value'
  | 'context'
  | 'frame-state'
  | 'effect'
  | 'control'
  | 'unknown';

export interface TurboFanEdge {
  source: number;
  target: number;
  index: number;
  type: TurboFanEdgeType;
}

export interface TurboFanGraphPhase {
  name: string;
  type: 'graph' | 'schedule' | 'code' | 'registerAllocation' | 'instructions';
  /** For type='graph' phases: structured node/edge data */
  nodes?: TurboFanNode[];
  edges?: TurboFanEdge[];
  /** For type='schedule' phases: raw schedule text */
  data?: string;
  /** Node count for graph phases */
  nodeCount?: number;
  /** Edge count for graph phases */
  edgeCount?: number;
}

export interface TurboFanIRGraph {
  function: TurboFanFunctionMeta;
  sources: Record<string, TurboFanFunctionMeta>;
  inlinings: Record<string, TurboFanInliningEntry>;
  phases: TurboFanGraphPhase[];
  phaseCount: number;
  totalNodeCount: number;
  totalEdgeCount: number;
  /** Opcode histogram across all graph phases */
  opcodeHistogram: Record<string, number>;
  /** Summary string for quick display */
  summary: string;
}

export interface ParsedTurboFanResult {
  available: boolean;
  graphs: TurboFanIRGraph[];
  graphCount: number;
  reason: string;
}

// ── Parser ─────────────────────────────────────────────────────────────────────

function parseFunctionMeta(raw: Record<string, unknown> | undefined): TurboFanFunctionMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    sourceId: typeof raw['sourceId'] === 'number' ? raw['sourceId'] : 0,
    functionName: typeof raw['functionName'] === 'string' ? raw['functionName'] : '<unknown>',
    sourceName: typeof raw['sourceName'] === 'string' ? raw['sourceName'] : '',
    sourceText: typeof raw['sourceText'] === 'string' ? raw['sourceText'] : '',
    startPosition: typeof raw['startPosition'] === 'number' ? raw['startPosition'] : -1,
    endPosition: typeof raw['endPosition'] === 'number' ? raw['endPosition'] : -1,
  };
}

function parseNode(raw: Record<string, unknown>): TurboFanNode {
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : -1,
    label: typeof raw['label'] === 'string' ? raw['label'] : '',
    title: typeof raw['title'] === 'string' ? raw['title'] : '',
    live: raw['live'] === true,
    properties: typeof raw['properties'] === 'string' ? raw['properties'] : '',
    opcode: typeof raw['opcode'] === 'string' ? raw['opcode'] : 'Unknown',
    control: raw['control'] === true,
    opinfo: typeof raw['opinfo'] === 'string' ? raw['opinfo'] : '',
    type: typeof raw['type'] === 'string' ? raw['type'] : '',
    sourcePosition:
      raw['sourcePosition'] !== null &&
      raw['sourcePosition'] !== undefined &&
      typeof raw['sourcePosition'] === 'object'
        ? (raw['sourcePosition'] as Record<string, unknown>)
        : undefined,
    origin:
      raw['origin'] !== null && raw['origin'] !== undefined && typeof raw['origin'] === 'object'
        ? (raw['origin'] as Record<string, unknown>)
        : undefined,
  };
}

function parseEdgeType(raw: string): TurboFanEdgeType {
  switch (raw) {
    case 'value':
    case 'context':
    case 'frame-state':
    case 'effect':
    case 'control':
      return raw;
    default:
      return 'unknown';
  }
}

function parseEdge(raw: Record<string, unknown>): TurboFanEdge {
  return {
    source: typeof raw['source'] === 'number' ? raw['source'] : -1,
    target: typeof raw['target'] === 'number' ? raw['target'] : -1,
    index: typeof raw['index'] === 'number' ? raw['index'] : -1,
    type: parseEdgeType(typeof raw['type'] === 'string' ? raw['type'] : 'unknown'),
  };
}

function parseGraphPhase(name: string, data: Record<string, unknown>): TurboFanGraphPhase {
  const rawNodes = Array.isArray(data['nodes']) ? data['nodes'] : [];
  const rawEdges = Array.isArray(data['edges']) ? data['edges'] : [];

  const nodes: TurboFanNode[] = [];
  for (const raw of rawNodes) {
    if (typeof raw === 'object' && raw !== null) {
      nodes.push(parseNode(raw as Record<string, unknown>));
    }
  }

  const edges: TurboFanEdge[] = [];
  for (const raw of rawEdges) {
    if (typeof raw === 'object' && raw !== null) {
      edges.push(parseEdge(raw as Record<string, unknown>));
    }
  }

  return {
    name,
    type: 'graph',
    nodes,
    edges,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

function buildOpcodeHistogram(phases: TurboFanGraphPhase[]): Record<string, number> {
  const histogram: Record<string, number> = {};
  for (const phase of phases) {
    if (!phase.nodes) continue;
    for (const node of phase.nodes) {
      const op = node.opcode;
      histogram[op] = (histogram[op] || 0) + 1;
    }
  }
  return histogram;
}

/** `sources` map: every entry that yields function metadata. */
function parseSources(rawSources: unknown): Record<string, TurboFanFunctionMeta> {
  const sources: Record<string, TurboFanFunctionMeta> = {};
  if (!rawSources || typeof rawSources !== 'object') {
    return sources;
  }
  for (const [key, value] of Object.entries(rawSources as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      const meta = parseFunctionMeta(value as Record<string, unknown>);
      if (meta) sources[key] = meta;
    }
  }
  return sources;
}

/** `inlinings` map, defaulting each numeric field and the position object. */
function parseInlinings(rawInlinings: unknown): Record<string, TurboFanInliningEntry> {
  const inlinings: Record<string, TurboFanInliningEntry> = {};
  if (!rawInlinings || typeof rawInlinings !== 'object') {
    return inlinings;
  }
  for (const [key, value] of Object.entries(rawInlinings as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      const entry = value as Record<string, unknown>;
      inlinings[key] = {
        inliningId: typeof entry['inliningId'] === 'number' ? entry['inliningId'] : 0,
        sourceId: typeof entry['sourceId'] === 'number' ? entry['sourceId'] : 0,
        inliningPosition:
          typeof entry['inliningPosition'] === 'object' && entry['inliningPosition'] !== null
            ? (entry['inliningPosition'] as Record<string, unknown>)
            : {},
      };
    }
  }
  return inlinings;
}

/**
 * One phase entry. `graph` phases parse their `data` into nodes/edges; other
 * types keep `data` as-is, stringifying non-string payloads so the shape stays
 * comparable across phase kinds.
 */
function parsePhase(rawPhase: unknown): TurboFanGraphPhase | null {
  if (typeof rawPhase !== 'object' || rawPhase === null) {
    return null;
  }
  const phase = rawPhase as Record<string, unknown>;
  const name = typeof phase['name'] === 'string' ? phase['name'] : '';
  const type = typeof phase['type'] === 'string' ? phase['type'] : '';
  const data = phase['data'];

  if (type === 'graph') {
    return data && typeof data === 'object'
      ? parseGraphPhase(name, data as Record<string, unknown>)
      : null;
  }
  if (type === 'schedule') {
    return { name, type: 'schedule', data: typeof data === 'string' ? data : '' };
  }
  return {
    name,
    type: type as TurboFanGraphPhase['type'],
    data: typeof data === 'string' ? data : JSON.stringify(data),
  };
}

/**
 * Parse a single turbo-*.json file content into a structured TurboFanIRGraph.
 */
export function parseTurboFanJSON(raw: string): TurboFanIRGraph | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const functionMeta = parseFunctionMeta(parsed['function'] as Record<string, unknown> | undefined);
  if (!functionMeta) return null;

  const sources = parseSources(parsed['sources']);
  const inlinings = parseInlinings(parsed['inlinings']);

  const phases: TurboFanGraphPhase[] = [];
  const rawPhases = parsed['phases'];
  if (Array.isArray(rawPhases)) {
    for (const rawPhase of rawPhases) {
      const phase = parsePhase(rawPhase);
      if (phase) phases.push(phase);
    }
  }

  const opcodeHistogram = buildOpcodeHistogram(phases);

  const totalNodeCount = phases.reduce((sum, p) => sum + (p.nodeCount ?? 0), 0);
  const totalEdgeCount = phases.reduce((sum, p) => sum + (p.edgeCount ?? 0), 0);

  const summaryParts: string[] = [
    `Function: ${functionMeta.functionName}`,
    `${phases.length} phases`,
    `${totalNodeCount} total nodes`,
    `${totalEdgeCount} total edges`,
  ];
  if (Object.keys(inlinings).length > 0) {
    summaryParts.push(`${Object.keys(inlinings).length} inlined calls`);
  }

  return {
    function: functionMeta,
    sources,
    inlinings,
    phases,
    phaseCount: phases.length,
    totalNodeCount,
    totalEdgeCount,
    opcodeHistogram,
    summary: summaryParts.join(' | '),
  };
}

/**
 * Parse multiple turbo-*.json content strings.
 */
export function parseTurboFanJSONFiles(
  files: Array<{ filename: string; content: string }>,
): ParsedTurboFanResult {
  const graphs: TurboFanIRGraph[] = [];

  for (const file of files) {
    const graph = parseTurboFanJSON(file.content);
    if (graph) {
      graphs.push(graph);
    }
  }

  return {
    available: graphs.length > 0,
    graphs,
    graphCount: graphs.length,
    reason:
      graphs.length > 0
        ? `Parsed ${graphs.length} TurboFan IR graph(s)`
        : 'No valid TurboFan JSON graphs found in output',
  };
}
