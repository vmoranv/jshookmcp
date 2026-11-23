import { describe, expect, it } from 'vitest';

import {
  MECHANISM_GROUPS,
  SEARCH_MECHANISMS,
  mechanismsByGroup,
  validateMechanisms,
} from '../../../scripts/search-tune/ablation';

describe('mechanism registry', () => {
  it('holds exactly the 18 mechanisms with unique ids', () => {
    expect(SEARCH_MECHANISMS).toHaveLength(18);
    expect(new Set(SEARCH_MECHANISMS.map((mechanism) => mechanism.id)).size).toBe(18);
  });

  it('covers every group at least once', () => {
    const covered = new Set(SEARCH_MECHANISMS.map((mechanism) => mechanism.group));
    for (const group of MECHANISM_GROUPS) {
      expect(covered.has(group)).toBe(true);
      expect(mechanismsByGroup(group).length).toBeGreaterThan(0);
    }
  });

  it('passes structural validation', () => {
    expect(validateMechanisms()).toEqual([]);
  });

  it('marks unneutralisable mechanisms as not-possible rather than zero', () => {
    const notPossible = SEARCH_MECHANISMS.filter(
      (mechanism) => mechanism.neutralization === 'not-possible',
    );
    expect(notPossible.map((mechanism) => mechanism.id)).toEqual([
      'bm25-core',
      'explicit-mention',
      'out-of-domain-gate',
      'rrf-fusion',
      'intent-bands',
      'workflow-transition',
      'confidence-floor',
    ]);
  });

  it('gives every config-zero mechanism a concrete neutraliser', () => {
    const configZero = SEARCH_MECHANISMS.filter(
      (mechanism) => mechanism.neutralization === 'config-zero',
    );
    for (const mechanism of configZero) {
      const hasNeutraliser = Boolean(mechanism.env || mechanism.searchConfig);
      expect(hasNeutraliser, mechanism.id).toBe(true);
    }
  });
});
