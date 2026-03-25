/**
 * ReverseEvidenceGraph type definitions.
 *
 * Models a reverse engineering evidence chain:
 * request → initiator-stack → script → function → breakpoint-hook → captured-data → replay-artifact
 */

/** The 7 node types in a reverse engineering evidence chain. */
export type EvidenceNodeType =
  | 'request'
  | 'initiator-stack'
  | 'script'
  | 'function'
  | 'breakpoint-hook'
  | 'captured-data'
  | 'replay-artifact';

/** Edge relationship types between evidence nodes. */
export type EvidenceEdgeType =
  | 'initiates' // request → initiator-stack
  | 'contains' // script → function
  | 'triggers' // function → breakpoint-hook
  | 'captures' // breakpoint-hook → captured-data
  | 'replays' // captured-data → replay-artifact
  | 'loads' // initiator-stack → script
  | 'references'; // generic cross-reference

/** A node in the evidence graph. */
export interface EvidenceNode {
  /** Unique node identifier. */
  readonly id: string;
  /** Node type category. */
  readonly type: EvidenceNodeType;
  /** Human-readable label. */
  label: string;
  /** Type-specific metadata (URL, function name, script ID, etc.). */
  metadata: Record<string, unknown>;
  /** Unix epoch ms when created. */
  readonly createdAt: number;
}

/** A directed edge between two evidence nodes. */
export interface EvidenceEdge {
  /** Unique edge identifier. */
  readonly id: string;
  /** Source node ID. */
  readonly source: string;
  /** Target node ID. */
  readonly target: string;
  /** Relationship type. */
  readonly type: EvidenceEdgeType;
  /** Optional edge metadata. */
  metadata?: Record<string, unknown>;
}

/** Serializable snapshot of the entire evidence graph. */
export interface EvidenceGraphSnapshot {
  version: 1;
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  exportedAt: string;
}
