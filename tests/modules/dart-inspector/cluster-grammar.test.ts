/**
 * Tests for {@link selectGrammar} and the seeded {@link GRAMMARS} table.
 *
 * These tests use only the synthetic placeholder entries shipped in
 * `cluster-grammar.ts` — no vendor data, no real Dart binaries.
 */

import { describe, expect, it } from 'vitest';

import { GRAMMARS, selectGrammar } from '@modules/dart-inspector/cluster-grammar';

describe('cluster-grammar table', () => {
  it('exports at least three structurally-distinct grammars', () => {
    expect(GRAMMARS.length).toBeGreaterThanOrEqual(3);
    const families = new Set(GRAMMARS.map((g) => g.sdkFamily));
    expect(families.size).toBe(GRAMMARS.length);
  });

  it('every grammar shape is internally consistent', () => {
    for (const g of GRAMMARS) {
      expect(g.sdkFamily.length).toBeGreaterThan(0);
      expect([4, 8]).toContain(g.pointerSize);
      expect(g.poolHeaderSize).toBeGreaterThan(0);
      expect([0, 1]).toContain(g.perSlotPrefixSize);
      expect(g.objectPoolCid).toBeGreaterThan(0);
      // knownCids must at least cover the keys ObjectPoolDumper consumes.
      for (const key of [
        'oneByteString',
        'twoByteString',
        'mint',
        'double',
        'objectPool',
        'null',
      ]) {
        expect(g.knownCids[key]).toBeDefined();
        expect(typeof g.knownCids[key]).toBe('number');
      }
      // The grammar's `objectPoolCid` MUST equal `knownCids.objectPool`.
      expect(g.knownCids['objectPool']).toBe(g.objectPoolCid);
    }
  });

  it('contains both a 4-byte and an 8-byte variant', () => {
    const widths = new Set(GRAMMARS.map((g) => g.pointerSize));
    expect(widths.has(4)).toBe(true);
    expect(widths.has(8)).toBe(true);
  });

  it('contains a slot-prefixed variant', () => {
    expect(GRAMMARS.some((g) => g.perSlotPrefixSize === 1)).toBe(true);
  });
});

describe('selectGrammar()', () => {
  it('returns undefined for entirely empty input', () => {
    expect(selectGrammar({})).toBeUndefined();
  });

  it('matches by exact forceGrammar override', () => {
    const g = selectGrammar({ forceGrammar: '2.17' });
    expect(g?.sdkFamily).toBe('2.17');
  });

  it('falls through to other heuristics when forceGrammar is unknown', () => {
    const g = selectGrammar({ forceGrammar: 'nonsense', dartSdkRev: '2.17.5' });
    expect(g?.sdkFamily).toBe('2.17');
  });

  it('matches by dartSdkRev prefix', () => {
    expect(selectGrammar({ dartSdkRev: '2.17.0' })?.sdkFamily).toBe('2.17');
    expect(selectGrammar({ dartSdkRev: '2.10.5' })?.sdkFamily).toBe('2.10');
    expect(selectGrammar({ dartSdkRev: '3.0+ build7' })?.sdkFamily).toBe('3.0+');
  });

  it('matches by major Flutter version', () => {
    expect(selectGrammar({ flutterVersion: '3.16.4' })?.sdkFamily).toBe('3.0+');
    expect(selectGrammar({ flutterVersion: '2.10.0' })?.sdkFamily).toBe('2.17');
    expect(selectGrammar({ flutterVersion: '2.0.0' })?.sdkFamily).toBe('2.10');
  });

  it('falls back to ARM32 grammar by targetArch when SDK info is absent', () => {
    const g = selectGrammar({ targetArch: 'arm32' });
    expect(g?.pointerSize).toBe(4);
  });

  it('returns undefined for unknown targetArch and no SDK info', () => {
    expect(selectGrammar({ targetArch: 'sparc' })).toBeUndefined();
  });
});
