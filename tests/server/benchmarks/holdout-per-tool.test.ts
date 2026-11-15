/**
 * E-phase: holdout per-tool evidence is a *query-level* generalization signal,
 * not a scalar. Locks the loader's honesty (missing/malformed => null, never a
 * guessed number) and the renderer's '—' for absent evidence.
 *
 * Tests use injectable temp files so they are deterministic on a fresh
 * checkout (artifacts/benchmarks/* are gitignored and may not exist yet).
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadHoldoutByTool,
  renderHoldoutMrr,
  type HoldoutEvidence,
} from '@tests/benchmarks/loaders';

function tempFile(content: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'jshook-holdout-'));
  const file = join(dir, 'registry-holdout-per-tool.json');
  writeFileSync(file, content);
  return { dir, file };
}

describe('loadHoldoutByTool (E: holdout evidence)', () => {
  it('returns null for a missing file (no evidence != bad evidence)', () => {
    expect(loadHoldoutByTool(join(tmpdir(), 'definitely-not-present-xyz.json'))).toBeNull();
  });

  it('returns null for malformed JSON (never a guessed value)', () => {
    const { dir, file } = tempFile('{ not json');
    try {
      expect(loadHoldoutByTool(file)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses per-tool evidence preserving bestRank (query-level dimension)', () => {
    const evidence: Record<string, HoldoutEvidence> = {
      webcrack_unpack: {
        queries: 1,
        hitAt3: 1,
        hitAt10: 1,
        bestRank: 3, // same tool, different phrasing -> ranks 3rd
        mrr: 0.333,
      },
      network_monitor: {
        queries: 2,
        hitAt3: 2,
        hitAt10: 2,
        bestRank: 1,
        mrr: 0.75,
      },
    };
    const { dir, file } = tempFile(JSON.stringify(evidence));
    try {
      const parsed = loadHoldoutByTool(file);
      expect(parsed).not.toBeNull();
      expect(parsed?.['webcrack_unpack']?.bestRank).toBe(3); // generalization gap visible
      expect(parsed?.['webcrack_unpack']?.mrr).toBeCloseTo(0.333, 3);
      expect(parsed?.['network_monitor']?.mrr).toBeCloseTo(0.75, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('renderHoldoutMrr (native-unit cell)', () => {
  it('renders "—" for absent evidence (never 0%)', () => {
    expect(renderHoldoutMrr(undefined)).toBe('—');
  });

  it('renders a percentage in its own unit', () => {
    expect(renderHoldoutMrr({ queries: 1, hitAt3: 1, hitAt10: 1, bestRank: 3, mrr: 0.375 })).toBe(
      '37.5%',
    );
    expect(renderHoldoutMrr({ queries: 1, hitAt3: 1, hitAt10: 1, bestRank: 1, mrr: 1 })).toBe(
      '100.0%',
    );
  });
});
