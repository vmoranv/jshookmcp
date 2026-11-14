import { describe, expect, it } from 'vitest';
import { SynonymExpander } from '@server/search/SynonymExpander';

import { vi } from 'vitest';

vi.mock('@src/constants', () => ({
  SEARCH_SYNONYM_EXPANSION_LIMIT: 3,
}));

describe('search/SynonymExpander', () => {
  const expander = new SynonymExpander();

  describe('expand()', () => {
    it('returns synonyms for known terms', () => {
      const result = expander.expand('navigate');
      expect(result).toContain('go');
      expect(result).toContain('open');
      expect(result).toContain('visit');
      expect(result).not.toContain('navigate'); // should not include self
    });

    it('is bidirectional: A→B implies B→A', () => {
      const captureResult = expander.expand('capture');
      expect(captureResult).toContain('intercept');

      const interceptResult = expander.expand('intercept');
      expect(interceptResult).toContain('capture');
    });

    it('returns empty array for unknown tokens', () => {
      expect(expander.expand('xyzunknownterm')).toEqual([]);
    });

    it('is case insensitive', () => {
      const result = expander.expand('Navigate');
      expect(result).toContain('go');
    });

    it('covers auth domain terms', () => {
      const result = expander.expand('token');
      expect(result).toContain('auth');
      expect(result).toContain('jwt');
    });

    it('covers debug domain terms', () => {
      const result = expander.expand('breakpoint');
      expect(result).toContain('pause');
      expect(result).toContain('halt');
    });

    it('covers transform domain terms', () => {
      const result = expander.expand('deobfuscate');
      expect(result).toContain('beautify');
      expect(result).toContain('unminify');
    });

    it('maps freeze to suspend (process suspension)', () => {
      const result = expander.expand('freeze');
      expect(result).toContain('suspend');
    });

    it('maps suspend to freeze (bidirectional)', () => {
      const result = expander.expand('suspend');
      expect(result).toContain('freeze');
    });

    it('maps emulator to nemu (native-emulator term-of-art)', () => {
      const result = expander.expand('emulator');
      expect(result).toContain('nemu');
    });

    it('maps nemu back to emulator (bidirectional)', () => {
      const result = expander.expand('nemu');
      expect(result).toContain('emulator');
    });

    it('keeps nemu within the first expansion slots of emulator', () => {
      // expand() returns the full merged synonym set in insertion order; the
      // engine only consumes the first SEARCH_SYNONYM_EXPANSION_LIMIT (2)
      // entries, so nemu must sit in the first two slots for the
      // "the emulator" → nemu_* mapping to fire at all.
      const result = expander.expand('emulator');
      expect(result.indexOf('nemu')).toBeGreaterThanOrEqual(0);
      expect(result.indexOf('nemu')).toBeLessThan(2);
    });

    it('maps remove to disable (aa-script removal grounding)', () => {
      const result = expander.expand('remove');
      expect(result).toContain('disable');
      // existing family members stay reachable
      expect(result).toContain('delete');
    });
  });

  describe('expandQuery()', () => {
    it('expands tokens with synonyms and deduplicates', () => {
      const result = expander.expandQuery(['navigate']);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(3); // expansion limit
      // should not contain original token
      expect(result).not.toContain('navigate');
    });

    it('respects expansion limit', () => {
      const result = expander.expandQuery(['navigate']);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('does not add tokens already present in the query', () => {
      // "go" is a synonym of "navigate", but if already in tokens, skip
      const result = expander.expandQuery(['navigate', 'go']);
      expect(result.filter((t) => t === 'go')).toHaveLength(0);
    });

    it('returns empty array for unknown tokens', () => {
      expect(expander.expandQuery(['xyzunknownterm'])).toEqual([]);
    });
  });
});
