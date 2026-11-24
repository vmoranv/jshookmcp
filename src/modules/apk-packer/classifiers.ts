/**
 * Classifier helpers for the apk-packer module.
 *
 * Provides:
 *   - compileSignatureInput: safe compilation of user-supplied
 *     PackerSignatureInput entries (rejects ReDoS heuristics and
 *     over-long patterns before constructing any RegExp).
 *   - mergeSignatures: combine defaults + custom signatures
 *     according to SignatureMode (append / prepend / replace).
 *   - testPatternTimed: post-hoc wall-clock runtime guard
 *     around .test() calls in the detector.
 */

import { ToolError } from '@errors/ToolError';
import { APK_PACKER_MAX_REGEX_PATTERN_LENGTH, APK_PACKER_REGEX_TIMEOUT_MS } from './constants';
import type { PackerSignature, PackerSignatureInput, SignatureMode } from './types';

/**
 * Heuristic patterns that flag catastrophic-backtracking shapes.
 * Not exhaustive - pairs with the runtime APK_PACKER_REGEX_TIMEOUT_MS guard.
 *
 * The quantified group may be followed by `*`, `+`, or `{n,}` — accepting
 * only `[+*]` let `(a+){2,}` slip through.
 */
const REDOS_HEURISTICS: readonly RegExp[] = Object.freeze([
  /\([^()]*[+*][^()]*\)\s*(?:[+*]|\{\d*,)/,
]);

/** A quantified group whose alternatives may consume the same input. */
const QUANTIFIED_GROUP_RE = /\(([^()]*)\)\s*(?:\*|\+|\{\d*,)/g;
/** Strip a leading `?:`, `?=`, `?!`, or `?<name>` from group contents. */
const GROUP_PREFIX_RE = /^\?(?:[:=!]|<[^>]*>)/;

type RegexToken =
  | { readonly kind: 'literal'; readonly char: string }
  | { readonly kind: 'class' }
  | { readonly kind: 'any' }
  | { readonly kind: 'escape'; readonly char: string };

/**
 * Approximate a run of regex source as a fixed sequence of single-character
 * matchers. Returns `null` for constructs this checker does not model
 * (nested groups, quantifiers, anchors) — callers treat that conservatively.
 */
function tokenizeAlternative(source: string): readonly RegexToken[] | null {
  const tokens: RegexToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === '\\') {
      const escaped = source[i + 1];
      if (escaped === undefined) return null;
      tokens.push({ kind: 'escape', char: escaped });
      i += 2;
      continue;
    }
    if (ch === '[') {
      let j = i + 1;
      let closed = false;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === ']') {
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) return null;
      tokens.push({ kind: 'class' });
      i = j + 1;
      continue;
    }
    if (ch === '.') {
      tokens.push({ kind: 'any' });
      i += 1;
      continue;
    }
    if ('+*?{}|()^$'.includes(ch)) return null;
    tokens.push({ kind: 'literal', char: ch });
    i += 1;
  }
  return tokens;
}

function escapeMatchesLiteral(escape: string, ch: string): boolean {
  switch (escape) {
    case 'd':
      return ch >= '0' && ch <= '9';
    case 'w':
      return /[A-Za-z0-9_]/.test(ch);
    case 's':
      return /\s/.test(ch);
    default:
      // A negated class or a control escape could match anything printable.
      return !/[A-Za-z0-9]/.test(escape) ? escape === ch : true;
  }
}

function tokensCouldOverlap(a: RegexToken, b: RegexToken): boolean {
  if (a.kind === 'any' || b.kind === 'any') return true;
  if (a.kind === 'class' || b.kind === 'class') return true;
  if (a.kind === 'literal' && b.kind === 'literal') return a.char === b.char;
  if (a.kind === 'escape' && b.kind === 'escape') {
    if (a.char === b.char) return true;
    if (!/[A-Za-z]/.test(a.char) && !/[A-Za-z]/.test(b.char)) return false;
    return true;
  }
  if (a.kind === 'escape') return escapeMatchesLiteral(a.char, (b as { char: string }).char);
  return escapeMatchesLiteral(b.char, (a as { char: string }).char);
}

/**
 * True when two alternatives share a compatible prefix, e.g. `a` vs `aa` in
 * `(a|aa)+`. Such overlap under a quantifier is the canonical ambiguous
 * alternation shape and backtracks catastrophically on a failing input.
 */
function alternativesOverlap(a: readonly RegexToken[], b: readonly RegexToken[]): boolean {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (!tokensCouldOverlap(a[i] as RegexToken, b[i] as RegexToken)) return false;
  }
  return true;
}

function hasAmbiguousQuantifiedAlternation(source: string): boolean {
  for (const match of source.matchAll(QUANTIFIED_GROUP_RE)) {
    const content = (match[1] ?? '').replace(GROUP_PREFIX_RE, '');
    if (!content.includes('|')) continue;
    const alternatives = content.split('|').map(tokenizeAlternative);
    // Unmodelled shapes are treated as unsafe (fail closed).
    if (alternatives.some((alt) => alt === null)) return true;
    const tokenized = alternatives as readonly (readonly RegexToken[])[];
    for (let i = 0; i < tokenized.length; i++) {
      for (let j = i + 1; j < tokenized.length; j++) {
        if (
          alternativesOverlap(
            tokenized[i] as readonly RegexToken[],
            tokenized[j] as readonly RegexToken[],
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function makeValidation(message: string, details?: Record<string, unknown>): ToolError {
  return new ToolError('VALIDATION', message, { details });
}

/**
 * Decide whether a user-supplied libPatterns source should be compiled
 * as a RegExp or kept as a literal lowercase filename.
 *
 * Promotion to regex requires explicit regex syntax: anchors,
 * quantifiers, character classes, alternation, groups, or escape
 * sequences. Bare dots and underscores do not promote.
 */
function looksLikeRegex(src: string): boolean {
  return /[\^$*+?()[\]{}|]/.test(src);
}

/**
 * Compile a single serialized PackerSignatureInput into a runtime
 * PackerSignature.
 *
 * String patterns that look like regex (contain metacharacters or
 * anchors) are compiled with the i flag; bare filenames stay as strings
 * (fastest matching path). Both paths reject ReDoS-shaped sources
 * before any RegExp is constructed.
 */
export function compileSignatureInput(input: PackerSignatureInput): PackerSignature {
  if (!input.name || input.name.length === 0) {
    throw makeValidation('customSignature.name must be a non-empty string');
  }
  if (input.category !== undefined && typeof input.category !== 'string') {
    throw makeValidation('customSignature.category, when present, must be a string', {
      name: input.name,
    });
  }
  if (!Array.isArray(input.libPatterns) || input.libPatterns.length === 0) {
    throw makeValidation('customSignature.libPatterns must be a non-empty array', {
      name: input.name,
    });
  }

  const compiled: (string | RegExp)[] = [];
  for (let i = 0; i < input.libPatterns.length; i++) {
    const src = input.libPatterns[i];
    if (typeof src !== 'string' || src.length === 0) {
      throw makeValidation(`customSignature.libPatterns[${i}] must be a non-empty string`, {
        name: input.name,
      });
    }
    if (src.length > APK_PACKER_MAX_REGEX_PATTERN_LENGTH) {
      throw makeValidation(
        `customSignature.libPatterns[${i}] exceeds APK_PACKER_MAX_REGEX_PATTERN_LENGTH (${APK_PACKER_MAX_REGEX_PATTERN_LENGTH})`,
        { name: input.name, length: src.length },
      );
    }
    if (looksLikeRegex(src)) {
      assertSafePattern(src, input.name);
      compiled.push(compileSafeRegex(src, 'i', input.name));
    } else {
      compiled.push(src.toLowerCase());
    }
  }

  const sig: PackerSignature = {
    name: input.name,
    libPatterns: compiled,
    ...(input.category ? { category: input.category } : {}),
    ...(input.confidence ? { confidence: input.confidence } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
  return sig;
}

function assertSafePattern(source: string, name: string): void {
  for (const heuristic of REDOS_HEURISTICS) {
    if (heuristic.test(source)) {
      throw makeValidation(
        'customSignature pattern rejected as potentially catastrophic (ReDoS heuristic match)',
        { name, pattern: source },
      );
    }
  }
  if (hasAmbiguousQuantifiedAlternation(source)) {
    throw makeValidation(
      'customSignature pattern rejected as potentially catastrophic (ReDoS heuristic match)',
      { name, pattern: source },
    );
  }
}

function compileSafeRegex(source: string, flags: string, name: string): RegExp {
  try {
    return new RegExp(source, flags);
  } catch (cause) {
    throw new ToolError(
      'VALIDATION',
      `customSignature regex failed to compile: ${(cause as Error).message}`,
      {
        details: { name, pattern: source, flags },
        cause: cause as Error,
      },
    );
  }
}

/** Combine defaults and custom signatures per the requested SignatureMode. */
export function mergeSignatures(
  defaults: readonly PackerSignature[],
  custom: readonly PackerSignature[] | undefined,
  mode: SignatureMode,
): readonly PackerSignature[] {
  if (mode === 'replace') {
    return Object.freeze([...(custom ?? [])]);
  }
  if (!custom || custom.length === 0) {
    return Object.freeze([...defaults]);
  }
  if (mode === 'prepend') {
    return Object.freeze([...custom, ...defaults]);
  }
  return Object.freeze([...defaults, ...custom]);
}

/**
 * Post-hoc runtime ReDoS guard. V8 cannot preempt a slow regex
 * execution, so we measure elapsed time after the fact and refuse to
 * keep running once we have seen one over budget.
 */
export function testPatternTimed(
  re: RegExp,
  value: string,
  timeoutMs: number = APK_PACKER_REGEX_TIMEOUT_MS,
  signatureName?: string,
): boolean {
  const start = performance.now();
  const result = re.test(value);
  const elapsed = performance.now() - start;
  if (elapsed > timeoutMs) {
    throw new ToolError(
      'TIMEOUT',
      `Regex match exceeded APK_PACKER_REGEX_TIMEOUT_MS (${timeoutMs} ms): ${elapsed.toFixed(2)} ms`,
      {
        details: {
          signatureName,
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
