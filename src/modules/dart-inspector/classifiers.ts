/**
 * Classifier helpers for the dart-inspector module.
 *
 * Provides:
 *   - {@link DEFAULT_RULES}: the 5-category baseline ruleset
 *   - {@link classifyOne}: first-match classification for a single string
 *   - {@link compileRuleInput}: safe regex compilation with ReDoS rejection
 *   - {@link mergeRules}: combine defaults + custom rules per RuleMode
 *   - {@link categorize}: bulk categorize a list of {@link ExtractedString}s
 *
 * @see openspec/changes/add-dart-strings-extract/design.md §3.3
 */

import {
  DART_ALLOWED_REGEX_FLAGS,
  DART_MAX_REGEX_PATTERN_LENGTH,
  DART_REGEX_TIMEOUT_MS,
} from '@src/constants';
import { ToolError } from '@errors/ToolError';
import type {
  CategoryKey,
  CategoryRule,
  CategoryRuleInput,
  ExtractedString,
  ExtractedStrings,
  RuleMode,
} from './types';

/**
 * Built-in classification rules. Order matters: the first matching rule wins.
 *
 * Tuning notes:
 *  - `paths` rule excludes static image extensions to avoid noise from asset paths.
 *  - `classNames` rule excludes all-caps strings (they fall through to
 *    `cryptoKeywords` if they match its alternation, otherwise stay unclassified).
 *  - `cryptoKeywords` is intentionally last among ALL_CAPS-friendly rules so
 *    "AES"/"RSA" land there rather than unclassified.
 */
export const DEFAULT_RULES: readonly CategoryRule[] = Object.freeze([
  { category: 'urls', pattern: /^https?:\/\/[^\s"'<>]+$/i },
  {
    category: 'paths',
    pattern: /^\/[a-z0-9_\-./]{2,}$/i,
    exclude: /\.(png|jpg|jpeg|gif|svg|webp)$/i,
  },
  { category: 'packageRefs', pattern: /^package:[a-z_][a-z0-9_]*\/[a-z0-9_./]+\.dart$/i },
  {
    category: 'cryptoKeywords',
    pattern: /^(AES|RSA|DES|HMAC|SHA\d+|MD5|encrypt(ion)?|decrypt|cipher|key)$/i,
  },
  { category: 'classNames', pattern: /^_?[A-Z][a-zA-Z0-9]{2,}$/, exclude: /^[A-Z0-9_]+$/ },
]);

/**
 * Heuristic patterns that flag catastrophic backtracking shapes
 * (e.g. `(a+)+`, `(a*)+b`, `(a|b)+c+`). Not exhaustive — pairs with the
 * runtime DART_REGEX_TIMEOUT_MS guard in StringsExtractor.
 */
const REDOS_HEURISTICS: readonly RegExp[] = Object.freeze([
  // (...+)+ or (...*)+
  /\([^()]*[+*][^()]*\)[+*]/,
  // alternation followed by ambiguous quantifier: (a|b)+c+ / (a|b)+(c)+
  /\([^()]*\|[^()]*\)[+*][^()]*[+*]/,
]);

function ensureValidationError(message: string, details?: Record<string, unknown>): ToolError {
  return new ToolError('VALIDATION', message, { details });
}

/**
 * Compile a serialized rule input to a runtime {@link CategoryRule}.
 *
 * Throws {@link ToolError} with code `VALIDATION` for any of:
 *  - empty `category`
 *  - empty `pattern`
 *  - `pattern.length > DART_MAX_REGEX_PATTERN_LENGTH`
 *  - flags outside `DART_ALLOWED_REGEX_FLAGS`
 *  - pattern matching a known catastrophic-backtracking heuristic
 *  - invalid regex syntax
 *
 * The same checks apply to `exclude` / `excludeFlags` when provided.
 */
export function compileRuleInput(input: CategoryRuleInput): CategoryRule {
  if (!input.category || input.category.length === 0) {
    throw ensureValidationError('customRule.category must be a non-empty string');
  }
  if (!input.pattern || input.pattern.length === 0) {
    throw ensureValidationError('customRule.pattern must be a non-empty string', {
      category: input.category,
    });
  }
  if (input.pattern.length > DART_MAX_REGEX_PATTERN_LENGTH) {
    throw ensureValidationError(
      `customRule.pattern length ${input.pattern.length} exceeds DART_MAX_REGEX_PATTERN_LENGTH (${DART_MAX_REGEX_PATTERN_LENGTH})`,
      { category: input.category },
    );
  }
  assertSafePattern(input.pattern, input.category);
  assertFlagsAllowed(input.flags ?? '', input.category);
  const pattern = compileSafeRegex(input.pattern, input.flags ?? '', input.category);

  let exclude: RegExp | undefined;
  if (input.exclude) {
    if (input.exclude.length > DART_MAX_REGEX_PATTERN_LENGTH) {
      throw ensureValidationError(
        `customRule.exclude length exceeds DART_MAX_REGEX_PATTERN_LENGTH (${DART_MAX_REGEX_PATTERN_LENGTH})`,
        { category: input.category },
      );
    }
    assertSafePattern(input.exclude, input.category);
    assertFlagsAllowed(input.excludeFlags ?? '', input.category);
    exclude = compileSafeRegex(input.exclude, input.excludeFlags ?? '', input.category);
  }

  return { category: input.category, pattern, exclude };
}

function assertSafePattern(source: string, category: CategoryKey): void {
  for (const heuristic of REDOS_HEURISTICS) {
    if (heuristic.test(source)) {
      throw ensureValidationError(
        `customRule pattern rejected as potentially catastrophic (ReDoS heuristic match)`,
        { category, pattern: source },
      );
    }
  }
}

function assertFlagsAllowed(flags: string, category: CategoryKey): void {
  const allowed = new Set(DART_ALLOWED_REGEX_FLAGS.split(''));
  for (const ch of flags) {
    if (!allowed.has(ch)) {
      throw ensureValidationError(
        `customRule flag "${ch}" not in DART_ALLOWED_REGEX_FLAGS (${DART_ALLOWED_REGEX_FLAGS})`,
        { category, flags },
      );
    }
  }
}

function compileSafeRegex(source: string, flags: string, category: CategoryKey): RegExp {
  try {
    return new RegExp(source, flags);
  } catch (cause) {
    throw new ToolError(
      'VALIDATION',
      `customRule regex failed to compile: ${(cause as Error).message}`,
      {
        details: { category, pattern: source, flags },
        cause: cause as Error,
      },
    );
  }
}

/** Return the category of the first matching rule, or `undefined` when nothing matches.
 *
 * Wraps every `.test()` call with a `performance.now()` measurement. When a
 * single test exceeds `timeoutMs` (default {@link DART_REGEX_TIMEOUT_MS}) a
 * `ToolError` with code `TIMEOUT` is thrown, aborting the entire extract.
 * This is the "post-hoc" runtime ReDoS guard described in the design doc
 * (red line 2): JavaScript regex execution cannot be preempted, so we cannot
 * interrupt the slow match in flight — but we can refuse to keep running
 * after we have seen one.
 */
export function classifyOne(
  value: string,
  rules: readonly CategoryRule[],
  timeoutMs: number = DART_REGEX_TIMEOUT_MS,
): CategoryKey | undefined {
  for (const rule of rules) {
    if (rule.exclude && timedTest(rule.exclude, value, timeoutMs, rule.category)) continue;
    if (timedTest(rule.pattern, value, timeoutMs, rule.category)) return rule.category;
  }
  return undefined;
}

function timedTest(re: RegExp, value: string, timeoutMs: number, category: CategoryKey): boolean {
  const start = performance.now();
  const result = re.test(value);
  const elapsed = performance.now() - start;
  if (elapsed > timeoutMs) {
    throw new ToolError(
      'TIMEOUT',
      `Regex match exceeded DART_REGEX_TIMEOUT_MS (${timeoutMs} ms): ${elapsed.toFixed(2)} ms`,
      {
        details: {
          category,
          pattern: re.source,
          flags: re.flags,
          elapsedMs: elapsed,
          timeoutMs,
        },
      },
    );
  }
  return result;
}

/** Combine defaults and custom rules per the requested {@link RuleMode}. */
export function mergeRules(
  defaults: readonly CategoryRule[],
  custom: readonly CategoryRule[] | undefined,
  mode: RuleMode,
): readonly CategoryRule[] {
  if (mode === 'replace') {
    return Object.freeze([...(custom ?? [])]);
  }
  if (!custom || custom.length === 0) {
    return Object.freeze([...defaults]);
  }
  if (mode === 'prepend') {
    return Object.freeze([...custom, ...defaults]);
  }
  // append (default)
  return Object.freeze([...defaults, ...custom]);
}

function sortAscByValue(a: ExtractedString, b: ExtractedString): number {
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

/**
 * Categorize a list of {@link ExtractedString}s into an {@link ExtractedStrings} result.
 *
 * Each input is classified by {@link classifyOne}. Hits populate the
 * corresponding category bucket; misses go to `raw` when `includeRaw=true`.
 * Within each bucket strings are sorted alphabetically by `value` so output
 * is deterministic across runs.
 *
 * The result is seeded with every category appearing in `rules` (as empty
 * arrays). Categories not referenced by any rule never appear in the output
 * — this means `ruleMode: 'replace'` cleanly removes the default keys.
 */
export function categorize(
  strings: readonly ExtractedString[],
  rules: readonly CategoryRule[],
  includeRaw: boolean,
  timeoutMs: number = DART_REGEX_TIMEOUT_MS,
): ExtractedStrings {
  const buckets = new Map<CategoryKey, ExtractedString[]>();
  // Seed buckets for every category referenced by the rule chain so they
  // appear as empty arrays in the output instead of being missing keys.
  for (const rule of rules) {
    if (!buckets.has(rule.category)) buckets.set(rule.category, []);
  }
  const rawBucket: ExtractedString[] = [];

  for (const item of strings) {
    const category = classifyOne(item.value, rules, timeoutMs);
    if (category === undefined) {
      if (includeRaw) rawBucket.push(item);
      continue;
    }
    const bucket = buckets.get(category);
    if (bucket) bucket.push(item);
    else buckets.set(category, [item]);
  }

  const result = {} as ExtractedStrings;
  for (const [key, items] of buckets) {
    result[key] = items.toSorted(sortAscByValue);
  }
  if (includeRaw) result.raw = rawBucket.toSorted(sortAscByValue);
  return result;
}
