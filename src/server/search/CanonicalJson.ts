/**
 * Canonical JSON helpers for catalog commitments and extension fingerprints.
 *
 * Two properties matter for a stable digest:
 *  - object keys are emitted in code-unit order, so logically identical values
 *    hash identically regardless of insertion order;
 *  - arrays keep their order. JSON Schema arrays (`enum`, `required`, `anyOf`)
 *    are order-significant, so sorting them would change the committed meaning.
 *
 * `compareCodeUnit` is deliberately locale-independent. `localeCompare` depends
 * on the host's ICU/locale, which would let the same catalog produce different
 * roots on different machines — unacceptable for a cryptographic commitment.
 */

/** Locale-independent string ordering (UTF-16 code units). */
export function compareCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic JSON serialization.
 *
 * `undefined` is serialized as a bare token instead of being dropped, so an
 * absent value and an explicit `undefined` stay distinguishable. `NaN` and
 * `±Infinity` collapse to `null`, matching `JSON.stringify`; tool schemas never
 * carry them.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .toSorted(compareCodeUnit)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}
