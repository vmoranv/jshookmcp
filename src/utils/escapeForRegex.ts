/**
 * Utility: escape a user-provided string for safe use in a RegExp constructor.
 * All regex metacharacters are escaped except `*`, which is preserved for
 * wildcard matching (converted to `.*` by callers).
 */
export function escapeRegexStr(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
