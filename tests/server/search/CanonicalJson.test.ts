import { describe, expect, it } from 'vitest';
import { compareCodeUnit, stableStringify } from '@server/search/CanonicalJson';

describe('CanonicalJson', () => {
  it('sorts object keys independent of insertion order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('preserves array order (order-significant JSON Schema keywords)', () => {
    const ascending = stableStringify({ enum: ['a', 'b'] });
    const descending = stableStringify({ enum: ['b', 'a'] });
    expect(ascending).not.toBe(descending);
    expect(stableStringify({ required: ['b', 'a'] })).toContain('["b","a"]');
  });

  it('keeps undefined distinguishable from null and the string "undefined"', () => {
    expect(stableStringify(undefined)).toBe('undefined');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('undefined')).toBe('"undefined"');
  });

  it('compares equal strings as zero', () => {
    expect(compareCodeUnit('tool', 'tool')).toBe(0);
    expect(compareCodeUnit('a', 'b')).toBeLessThan(0);
    expect(compareCodeUnit('b', 'a')).toBeGreaterThan(0);
  });

  it('orders by UTF-16 code units, not locale', () => {
    const names = ['b_tool', 'A_tool', 'a_tool', '_tool', '0_tool'];
    expect(names.toSorted(compareCodeUnit)).toEqual([
      '0_tool',
      'A_tool',
      '_tool',
      'a_tool',
      'b_tool',
    ]);
  });
});
