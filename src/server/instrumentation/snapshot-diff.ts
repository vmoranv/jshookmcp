/**
 * Pure-function diffing for instrumentation session snapshots.
 *
 * Used by instrumentation_session_diff to compare two sessions without any
 * session-manager mutation. Kept side-effect-free so it is trivially unit-testable.
 */

import type {
  InstrumentationArtifact,
  InstrumentationOperation,
  InstrumentationSessionSnapshot,
} from './types';

export interface SessionOperationDiff {
  /** Operations present in B but not A (by id). */
  addedInB: InstrumentationOperation[];
  /** Operations present in A but not B (by id). */
  removedFromA: InstrumentationOperation[];
  /** Operation ids present in both, with type/target for quick scanning. */
  common: Array<{ id: string; type: string; target: string }>;
}

export interface SessionArtifactTypeCount {
  type: string;
  countA: number;
  countB: number;
  delta: number;
}

export interface SessionArtifactDiff {
  /** Distinct artifact fingerprints only in A. */
  onlyInA: number;
  /** Distinct artifact fingerprints only in B. */
  onlyInB: number;
  /** Distinct artifact fingerprints in both. */
  common: number;
  /** Per-type artifact counts (A vs B + delta). */
  byType: SessionArtifactTypeCount[];
}

export interface SessionSnapshotDiff {
  sessions: { aId: string; bId: string };
  operations: SessionOperationDiff;
  artifacts: SessionArtifactDiff;
  stats: {
    operationCountDelta: number;
    artifactCountDelta: number;
  };
}

/**
 * Deterministic serialization (sorted keys) so logically identical artifact
 * data always yields the same fingerprint regardless of key insertion order.
 * Captured payloads are `unknown` and may be circular or non-serializable, so
 * serialization is bounded and callers fall back to a per-artifact key.
 */
function stableStringify(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  const object = value as object;
  if (seen.has(object)) return '"[circular]"';
  seen.add(object);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item, seen)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`)
      .join(',')}}`;
  } finally {
    seen.delete(object);
  }
}

/** Stable fingerprint for an artifact (type + canonical data JSON). */
function artifactFingerprint(a: InstrumentationArtifact): string {
  try {
    return `${a.type}:${stableStringify(a.data)}`;
  } catch {
    // Non-serializable payload: keep the diff honest with a per-artifact key
    // instead of failing the whole comparison.
    return `${a.type}:<unserializable>:${a.operationId}:${a.timestamp}`;
  }
}

function countByType(artifacts: InstrumentationArtifact[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of artifacts) {
    counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  }
  return counts;
}

/**
 * Compare two session snapshots. Operations are compared by id; artifacts by a
 * type+data fingerprint (artifacts have no stable id of their own). Pure: does
 * not touch either session.
 */
export function diffSessionSnapshots(
  a: InstrumentationSessionSnapshot,
  b: InstrumentationSessionSnapshot,
): SessionSnapshotDiff {
  const aOps = new Map(a.operations.map((o) => [o.id, o]));

  const addedInB: InstrumentationOperation[] = [];
  const common: Array<{ id: string; type: string; target: string }> = [];
  for (const op of b.operations) {
    if (aOps.has(op.id)) {
      common.push({ id: op.id, type: op.type, target: op.target });
    } else {
      addedInB.push(op);
    }
  }

  const removedFromA: InstrumentationOperation[] = [];
  const bOpIds = new Set(b.operations.map((o) => o.id));
  for (const op of a.operations) {
    if (!bOpIds.has(op.id)) {
      removedFromA.push(op);
    }
  }

  // Artifact diff by data fingerprint (type + canonical data JSON).
  const aFp = new Set(a.artifacts.map(artifactFingerprint));
  const bFp = new Set(b.artifacts.map(artifactFingerprint));
  let onlyInA = 0;
  let commonArtifacts = 0;
  for (const fp of aFp) {
    if (bFp.has(fp)) commonArtifacts++;
    else onlyInA++;
  }
  let onlyInB = 0;
  for (const fp of bFp) {
    if (!aFp.has(fp)) onlyInB++;
  }

  const aTypes = countByType(a.artifacts);
  const bTypes = countByType(b.artifacts);
  const allTypes = new Set<string>([...aTypes.keys(), ...bTypes.keys()]);
  const byType: SessionArtifactTypeCount[] = [...allTypes].map((type) => {
    const countA = aTypes.get(type) ?? 0;
    const countB = bTypes.get(type) ?? 0;
    return { type, countA, countB, delta: countB - countA };
  });

  return {
    sessions: { aId: a.session.id, bId: b.session.id },
    operations: { addedInB, removedFromA, common },
    artifacts: { onlyInA, onlyInB, common: commonArtifacts, byType },
    stats: {
      operationCountDelta: b.operations.length - a.operations.length,
      artifactCountDelta: b.artifacts.length - a.artifacts.length,
    },
  };
}
