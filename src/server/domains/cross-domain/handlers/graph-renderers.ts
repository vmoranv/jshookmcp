/**
 * Pure-function renderers that turn an `EvidenceGraphSnapshot` into external
 * visualization formats (Mermaid flowchart + Graphviz DOT) so analysts can drop
 * the cross-domain evidence graph straight into Markdown, graphviz, or any
 * mermaid-aware renderer.
 *
 * The graph is serialized to stable node indices (`N0..Nn`) so labels and edge
 * types carrying arbitrary characters never break the host grammar. Large graphs
 * are truncated to bounded budgets with an honest `truncated` report — no silent
 * context flooding.
 */
import type { EvidenceEdge, EvidenceGraphSnapshot } from '@server/evidence/types';

export interface GraphRenderOptions {
  /** Maximum nodes to render before truncating (defaults to 200). */
  maxNodes?: number;
  /** Maximum edges to render before truncating (defaults to 500). */
  maxEdges?: number;
  /** Maximum characters per node/edge label before ellipsis truncation (defaults to 60). */
  labelMaxLength?: number;
}

export interface RenderedGraph {
  format: 'mermaid' | 'dot';
  content: string;
  nodeCount: number;
  edgeCount: number;
  renderedNodes: number;
  renderedEdges: number;
  truncated: { nodes: number; edges: number };
}

const DEFAULT_MAX_NODES = 200;
const DEFAULT_MAX_EDGES = 500;
const DEFAULT_LABEL_MAX_LENGTH = 60;

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  return n > 0 ? n : fallback;
}

function truncateLabel(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Escape a label for Mermaid `["..."]` node labels and `-- "..." -->` edge
 * labels. Mermaid's quoted-string grammar is intolerant of unbalanced `[` / `]`
 * inside node bodies, so we neutralize the bracket characters along with the
 * quote and newline.
 */
function escapeMermaidLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, "'")
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\n/g, ' ')
    .trim();
}

/** Escape a label for DOT `label="..."` attribute values per graphviz lex rules. */
function escapeDotLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

interface NodeSlice {
  idToIndex: Map<string, number>;
  rendered: EvidenceGraphSnapshot['nodes'];
  truncatedNodes: number;
}

function buildNodeSlice(snapshot: EvidenceGraphSnapshot, maxNodes: number): NodeSlice {
  const rendered = snapshot.nodes.slice(0, maxNodes);
  const idToIndex = new Map<string, number>();
  rendered.forEach((node, index) => {
    idToIndex.set(node.id, index);
  });
  return {
    idToIndex,
    rendered,
    truncatedNodes: Math.max(0, snapshot.nodes.length - rendered.length),
  };
}

function selectEdgesWithinSlice(
  snapshot: EvidenceGraphSnapshot,
  idToIndex: Map<string, number>,
  maxEdges: number,
): { edges: EvidenceEdge[]; budgetTruncated: number } {
  const within: EvidenceEdge[] = [];
  let budgetTruncated = 0;
  for (const edge of snapshot.edges) {
    if (!idToIndex.has(edge.source) || !idToIndex.has(edge.target)) {
      // Dangling after node truncation — drop silently, not counted against the edge budget.
      continue;
    }
    if (within.length >= maxEdges) {
      budgetTruncated += 1;
      continue;
    }
    within.push(edge);
  }
  return { edges: within, budgetTruncated };
}

function resolveOptions(options: GraphRenderOptions) {
  return {
    maxNodes: clampPositiveInt(options.maxNodes, DEFAULT_MAX_NODES),
    maxEdges: clampPositiveInt(options.maxEdges, DEFAULT_MAX_EDGES),
    labelMaxLength: clampPositiveInt(options.labelMaxLength, DEFAULT_LABEL_MAX_LENGTH),
  };
}

export function renderEvidenceGraphMermaid(
  snapshot: EvidenceGraphSnapshot,
  options: GraphRenderOptions = {},
): RenderedGraph {
  const { maxNodes, maxEdges, labelMaxLength } = resolveOptions(options);
  const { idToIndex, rendered, truncatedNodes } = buildNodeSlice(snapshot, maxNodes);
  const { edges } = selectEdgesWithinSlice(snapshot, idToIndex, maxEdges);

  const lines: string[] = ['flowchart LR'];
  lines.push(
    `%% ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges ` +
      `(rendered ${rendered.length}/${snapshot.nodes.length} nodes, ` +
      `${edges.length}/${snapshot.edges.length} edges)`,
  );

  for (const node of rendered) {
    const index = idToIndex.get(node.id);
    if (index === undefined) continue;
    const label = escapeMermaidLabel(truncateLabel(node.label || node.id, labelMaxLength));
    lines.push(`  N${index}["${label}"]`);
  }
  for (const edge of edges) {
    const source = idToIndex.get(edge.source);
    const target = idToIndex.get(edge.target);
    if (source === undefined || target === undefined) continue;
    const label = escapeMermaidLabel(truncateLabel(edge.type, labelMaxLength));
    lines.push(`  N${source} -- "${label}" --> N${target}`);
  }

  return {
    format: 'mermaid',
    content: lines.join('\n'),
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    renderedNodes: rendered.length,
    renderedEdges: edges.length,
    truncated: { nodes: truncatedNodes, edges: snapshot.edges.length - edges.length },
  };
}

export function renderEvidenceGraphDot(
  snapshot: EvidenceGraphSnapshot,
  options: GraphRenderOptions = {},
): RenderedGraph {
  const { maxNodes, maxEdges, labelMaxLength } = resolveOptions(options);
  const { idToIndex, rendered, truncatedNodes } = buildNodeSlice(snapshot, maxNodes);
  const { edges } = selectEdgesWithinSlice(snapshot, idToIndex, maxEdges);

  const lines: string[] = ['digraph evidence {', '  rankdir=LR;'];
  for (const node of rendered) {
    const index = idToIndex.get(node.id);
    if (index === undefined) continue;
    const label = escapeDotLabel(truncateLabel(node.label || node.id, labelMaxLength));
    lines.push(`  "N${index}" [label="${label}"];`);
  }
  for (const edge of edges) {
    const source = idToIndex.get(edge.source);
    const target = idToIndex.get(edge.target);
    if (source === undefined || target === undefined) continue;
    const label = escapeDotLabel(truncateLabel(edge.type, labelMaxLength));
    lines.push(`  "N${source}" -> "N${target}" [label="${label}"];`);
  }
  lines.push('}');

  return {
    format: 'dot',
    content: lines.join('\n'),
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    renderedNodes: rendered.length,
    renderedEdges: edges.length,
    truncated: { nodes: truncatedNodes, edges: snapshot.edges.length - edges.length },
  };
}
