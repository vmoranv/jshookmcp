/**
 * Caller-supplied custom regex patterns for `binary_key_extract`
 * (A-phase, change `close-descoped-behaviors`).
 *
 * Security posture (two lines, mirroring the rest of the module):
 *   1. Compile-time: reject `/.../flags` wrappers, invalid regex, over-long
 *      patterns, and obvious catastrophic-backtracking shapes.
 *   2. Runtime: every match loop is bounded by an injected clock +
 *      BINARY_SECRETS_CUSTOM_PATTERN_TIMEOUT_MS budget; a pattern that
 *      cannot finish in budget aborts the whole call with TIMEOUT.
 *
 * Patterns are matched against a **latin1 view** of each chunk so byte
 * offsets map 1:1 to file offsets (no UTF-8 multibyte drift). The matched
 * bytes are payload only — never executed.
 */
import { ToolError } from '@errors/ToolError';

import {
  BINARY_SECRETS_CUSTOM_PATTERN_TIMEOUT_MS,
  BINARY_SECRETS_MAX_CUSTOM_PATTERN_LENGTH,
} from './constants';
import type { CustomPattern } from './types';

export interface CompiledCustomPattern {
  readonly re: RegExp;
  readonly category?: string;
}

/** A match produced by a custom pattern (module-local, byte-oriented). */
export interface CustomHit {
  readonly absOffset: number;
  readonly length: number;
  readonly format: 'custom';
  readonly bytes: Uint8Array;
  readonly customCategory?: string;
}

/** Heuristics flagging obvious ReDoS shapes. */
const REDOS_HEURISTICS: readonly RegExp[] = Object.freeze([
  /\([^()]*[+*][^()]*\)[+*]/, // nested quantifier, e.g. (a+)+
  /\([^()]*\|[^()]*\)[+*][^()]*[+*]/, // quantified alternation + more quantifiers
  /\([^()]*\|[^()]*\)[+*]/, // quantified alternation, e.g. (a|aa)+ (ambiguous overlap)
]);

/** A `/.../flags` wrapper (we accept raw regex source only, never caller flags). */
const FLAG_WRAPPER = /^\/(.+)\/([dgimsuvy]*)$/s;

export function compileCustomPattern(spec: CustomPattern): CompiledCustomPattern {
  if (!spec || typeof spec.pattern !== 'string') {
    throw new ToolError('VALIDATION', 'customPatterns[].pattern must be a string');
  }
  const pattern = spec.pattern;
  if (pattern.length === 0) {
    throw new ToolError('VALIDATION', 'customPatterns[].pattern must not be empty');
  }
  if (pattern.length > BINARY_SECRETS_MAX_CUSTOM_PATTERN_LENGTH) {
    throw new ToolError(
      'VALIDATION',
      `customPatterns[].pattern exceeds BINARY_SECRETS_MAX_CUSTOM_PATTERN_LENGTH (${BINARY_SECRETS_MAX_CUSTOM_PATTERN_LENGTH})`,
    );
  }
  if (FLAG_WRAPPER.test(pattern)) {
    throw new ToolError(
      'VALIDATION',
      'customPatterns[].pattern must be raw regex source without /.../flags (flags are not allowed)',
    );
  }
  for (const heuristic of REDOS_HEURISTICS) {
    if (heuristic.test(pattern)) {
      throw new ToolError(
        'VALIDATION',
        'customPatterns[].pattern rejected as potentially catastrophic (ReDoS heuristic match)',
      );
    }
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'g');
  } catch (cause) {
    throw new ToolError(
      'VALIDATION',
      `customPatterns[].pattern failed to compile as regex: ${(cause as Error).message}`,
      { cause: cause as Error },
    );
  }
  return {
    re,
    ...(typeof spec.category === 'string' && spec.category.length > 0
      ? { category: spec.category }
      : {}),
  };
}

/**
 * Scan one buffer with all compiled patterns. `clock` is injectable (tests);
 * default is performance.now. Throws TIMEOUT when the cumulative match budget
 * is exceeded. Global regex `lastIndex` is reset per pattern per chunk.
 */
export function scanCustomPatterns(
  buf: Uint8Array,
  baseOffset: number,
  compiled: readonly CompiledCustomPattern[],
  clock: () => number = () => performance.now(),
): readonly CustomHit[] {
  const hits: CustomHit[] = [];
  if (compiled.length === 0) return hits;
  const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('latin1');
  const deadline = clock() + BINARY_SECRETS_CUSTOM_PATTERN_TIMEOUT_MS;

  for (const { re, category } of compiled) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(view)) !== null) {
      if (clock() > deadline) {
        throw new ToolError(
          'TIMEOUT',
          `custom pattern matching exceeded BINARY_SECRETS_CUSTOM_PATTERN_TIMEOUT_MS (${BINARY_SECRETS_CUSTOM_PATTERN_TIMEOUT_MS} ms)`,
        );
      }
      const text = m[0];
      if (text.length === 0) {
        // Zero-width match: nudge lastIndex to avoid an infinite loop.
        re.lastIndex += 1;
        continue;
      }
      const bytes = Uint8Array.from(Buffer.from(text, 'latin1'));
      hits.push({
        absOffset: baseOffset + m.index,
        length: bytes.length,
        format: 'custom',
        bytes,
        ...(category !== undefined ? { customCategory: category } : {}),
      });
    }
  }
  return hits;
}
