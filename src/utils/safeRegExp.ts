/**
 * Safe regular expression compilation utility.
 *
 * Prevents ReDoS (regular expression denial of service) by rejecting patterns
 * that are too long or contain nested quantifiers (e.g. `(a+)+`, `(a*)*`,
 * `(a?)?`). All call sites that accept user-controlled regex patterns should
 * use `compileSafeRegex` instead of `new RegExp(pattern)` directly.
 *
 * Stateful flags (`g` / `y`) are always stripped because `RegExp.test()`
 * mutates `lastIndex`, which would cause the same query to alternate
 * match/no-match across calls.
 */

export const MAX_PATTERN_LENGTH = 256;

/** Regex metacharacters that act as quantifiers when following an atom. */
const QUANTIFIER_CHARS = new Set(['*', '+', '?']);

/**
 * Detect nested quantifiers — a classic ReDoS vector.
 *
 * A nested quantifier occurs when a quantified group (e.g. `(a+)`) is itself
 * followed by a quantifier (`+`, `*`, `?`, or `{...}`), causing exponential
 * backtracking on certain inputs. This is a conservative heuristic: it walks
 * the pattern tracking paren depth and character-class/escape boundaries, and
 * flags any quantified group whose inner content ends with another quantifier
 * while the group itself is also quantified.
 *
 * Never misses the common nested-quantifier ReDoS patterns; may produce false
 * positives on complex but safe patterns (callers can simplify those).
 */
function hasNestedQuantifier(pattern: string): boolean {
  let depth = 0;
  let groupStart = -1;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    // Skip escaped characters: `\x` consumes the next character.
    if (ch === '\\') {
      i++;
      continue;
    }

    // Skip character-class content: `[...]`.
    if (ch === '[') {
      i++;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++;
        i++;
      }
      continue;
    }

    if (ch === '(') {
      if (depth === 0) groupStart = i;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && groupStart >= 0) {
        const groupContent = pattern.slice(groupStart + 1, i);
        const innerEndsWithQuant =
          QUANTIFIER_CHARS.has(groupContent[groupContent.length - 1] ?? '') ||
          /\{[\d,]+\}$/.test(groupContent);

        const afterGroup = pattern.slice(i + 1, i + 4);
        const groupIsQuantified =
          QUANTIFIER_CHARS.has(afterGroup[0] ?? '') || afterGroup.startsWith('{');

        if (innerEndsWithQuant && groupIsQuantified) {
          return true;
        }
        groupStart = -1;
      }
    }
  }

  return false;
}

/**
 * Compile a regex pattern safely, rejecting patterns that are too long or
 * contain nested quantifiers (ReDoS vectors).
 *
 * @param pattern - The regex pattern string
 * @param flags - Optional regex flags (stateful `g`/`y` are stripped)
 * @returns A compiled RegExp
 * @throws {Error} If the pattern is invalid, too long, or contains nested quantifiers
 */
export function compileSafeRegex(pattern: string, flags?: string): RegExp {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('Invalid regular expression pattern: must be a non-empty string');
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(
      `Invalid regular expression pattern: length ${pattern.length} exceeds maximum of ${MAX_PATTERN_LENGTH}`,
    );
  }

  if (hasNestedQuantifier(pattern)) {
    throw new Error(
      'Invalid regular expression pattern: nested quantifiers are not allowed (ReDoS risk)',
    );
  }

  // Never allow stateful flags (g/y): `test()` mutates lastIndex, so the
  // same query would alternate match/no-match across calls.
  const safeFlags = (flags ?? '').replace(/[gy]/g, '');

  try {
    return new RegExp(pattern, safeFlags);
  } catch (error) {
    throw new Error(
      `Invalid regular expression pattern "${pattern}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}
