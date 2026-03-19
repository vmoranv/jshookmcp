import { describe, expect, it } from 'vitest';
import { TrigramIndex } from '@server/search/TrigramIndex';

describe('search/TrigramIndex', () => {
  const names = ['page_navigate', 'page_click', 'debug_pause', 'network_enable', 'breakpoint_set'];
  const index = new TrigramIndex(names);

  describe('extractTrigrams()', () => {
    it('extracts correct trigrams from a name', () => {
      const trigrams = TrigramIndex.extractTrigrams('navigate');
      expect(trigrams).toContain('nav');
      expect(trigrams).toContain('avi');
      expect(trigrams).toContain('vig');
      expect(trigrams).toContain('iga');
      expect(trigrams).toContain('gat');
      expect(trigrams).toContain('ate');
    });

    it('normalises underscores away', () => {
      const trigrams = TrigramIndex.extractTrigrams('page_navigate');
      // "page_navigate" → "pagenavigate" → trigrams of that
      expect(trigrams).toContain('pag');
      expect(trigrams).toContain('age');
      expect(trigrams).toContain('gen'); // "gen" from "agenaviga"
    });

    it('returns empty set for short strings', () => {
      const trigrams = TrigramIndex.extractTrigrams('ab');
      expect(trigrams.size).toBe(0);
    });
  });

  describe('search()', () => {
    it('returns high similarity for exact matches', () => {
      const results = index.search('page_navigate', 0.3);
      expect(results.has(0)).toBe(true); // index 0 = page_navigate
      expect(results.get(0)!).toBeGreaterThan(0.8);
    });

    it('finds similar names despite typos', () => {
      // "nagivate" is a common typo for "navigate"
      const results = index.search('page_nagivate', 0.2);
      // Should still match page_navigate (index 0) with decent similarity
      expect(results.has(0)).toBe(true);
      expect(results.get(0)!).toBeGreaterThan(0.3);
    });

    it('returns empty map for completely unrelated strings', () => {
      const results = index.search('xyzabcdef', 0.5);
      expect(results.size).toBe(0);
    });

    it('returns empty map for empty queries', () => {
      const results = index.search('', 0.3);
      expect(results.size).toBe(0);
    });

    it('respects threshold parameter', () => {
      const lowThreshold = index.search('page', 0.1);
      const highThreshold = index.search('page', 0.8);
      expect(lowThreshold.size).toBeGreaterThanOrEqual(highThreshold.size);
    });
  });
});
