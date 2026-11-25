/**
 * Match a value against a wildcard pattern where `*` means "any characters"
 * (including none).
 *
 * - A pattern WITHOUT stars is a literal substring match (callers use this for
 *   host/prefix rules such as a bare URL that should match every path under it).
 * - A pattern WITH stars follows glob semantics: without a leading `*` the
 *   first segment is anchored to the start of the value; without a trailing `*`
 *   the last segment is anchored to the end of the value. So `foo*` matches
 *   strings starting with `foo`, `*foo` matches strings ending with `foo`, and
 *   `foo*bar` matches `foobar` but not `xfoobar`.
 *
 * An empty pattern (and a pattern of only stars) matches everything.
 */
export function matchesWildcardPattern(value: string, pattern: string): boolean {
  if (pattern.length === 0) {
    return true;
  }

  if (!pattern.includes('*')) {
    return value.includes(pattern);
  }

  const segments = pattern.split('*').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return true; // pattern is only `*`s — matches anything
  }

  const anchoredStart = !pattern.startsWith('*');
  const anchoredEnd = !pattern.endsWith('*');

  let offset = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const isLast = i === segments.length - 1;
    // A trailing anchored segment must be matched against its LAST occurrence:
    // a leftmost `indexOf` finds an earlier occurrence and then fails the
    // end-anchor check (e.g. '*foo' against 'foobarfoo').
    const nextIndex =
      isLast && anchoredEnd ? value.lastIndexOf(segment) : value.indexOf(segment, offset);
    if (nextIndex === -1 || nextIndex < offset) {
      return false;
    }
    // The first segment must sit at the very start of the value unless the
    // pattern begins with a star.
    if (i === 0 && anchoredStart && nextIndex !== 0) {
      return false;
    }
    offset = nextIndex + segment.length;
  }

  // The last segment must reach the very end of the value unless the pattern
  // ends with a star.
  return !anchoredEnd || offset === value.length;
}
