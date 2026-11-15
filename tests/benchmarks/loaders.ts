/**
 * Shared artifact loaders for the per-tool scorecard.
 *
 * E-phase: holdout evidence is a query-level generalization signal (the same
 * tool can rank 1st on its own phrasing and 3rd on a blind paraphrase). It is
 * loaded as a per-tool map and rendered in its native unit, never collapsed
 * into a composite score.
 *
 * Honesty rules: a missing or malformed artifact yields `null` (no evidence is
 * not bad evidence), and an absent per-tool cell renders `—`, never `0%`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const HOLDOUT_PER_TOOL_FILE = join(
  ROOT,
  'artifacts',
  'benchmarks',
  'registry-holdout-per-tool.json',
);

export interface HoldoutEvidence {
  readonly queries: number;
  readonly hitAt3: number;
  readonly hitAt10: number;
  readonly bestRank: number | null;
  readonly mrr: number;
}

function isHoldoutEvidence(value: unknown): value is HoldoutEvidence {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['queries'] === 'number' &&
    typeof v['hitAt3'] === 'number' &&
    typeof v['hitAt10'] === 'number' &&
    typeof v['mrr'] === 'number' &&
    (v['bestRank'] === null || typeof v['bestRank'] === 'number')
  );
}

/** Load per-tool holdout evidence. Missing/malformed => null (never a guess). */
export function loadHoldoutByTool(
  file: string = HOLDOUT_PER_TOOL_FILE,
): Record<string, HoldoutEvidence> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, HoldoutEvidence> = {};
    for (const [tool, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isHoldoutEvidence(value)) out[tool] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Render one holdout cell in its native unit (percentage), or '—'. */
export function renderHoldoutMrr(evidence: HoldoutEvidence | undefined): string {
  if (!evidence) return '—';
  return `${(evidence.mrr * 100).toFixed(1)}%`;
}
