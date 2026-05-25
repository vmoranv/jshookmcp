/**
 * Classifier helpers for the apk-packer module.
 *
 * Provides:
 *   - {@link compileSignatureInput}: safe compilation of user-supplied
 *     {@link PackerSignatureInput} entries (rejects ReDoS heuristics and
 *     over-long patterns before constructing any `RegExp`).
 *   - {@link mergeSignatures}: combine defaults + custom signatures
 *     according to {@link SignatureMode} (append / prepend / replace).
 *   - {@link testPatternTimed}: post-hoc wall-clock runtime guard
 *     around `.test()` calls in the detector.
 */

import { ToolError } from '@errors/ToolError';
import { APK_PACKER_MAX_REGEX_PATTERN_LENGTH, APK_PACKER_REGEX_TIMEOUT_MS } from './constants';
import type { PackerSignature, PackerSignatureInput, SignatureMode } from './types';

/**
 * Heuristic patterns that flag catastrophic-backtracking shapes
 * (e.g. `(a+)+`, `(a*)+b`, `(a|b)+c+`). Not exhaustive — pairs with
 * the runtime APK_PACKER_REGEX_TIMEOUT_MS guard.
 */
const REDOS_HEURISTICS: readonly RegExp[] = Object.freeze([
  // (...+)+ or (...*)+
  /\([^()]*[+*][^()]*\)[+*]/,
  // alternation followed by ambiguous quantifier: (a|b)+c+ etc.
  /\([^()]*\|[^()]*\)[+*][^()]*[+*]/,
]);

function makeValidation(message: string, details?: Record<string, unknown>): ToolError {
  return new ToolError('VALIDATION', message, { details });
}

/**
 * Decide whether a user-supplied `libPatterns` source is a RegExp source
 * (anchored or contains metacharacters) or a literal filename.
 */
function looksLikeRegex(src: string): boolean {
  // Anchored, contains alternation, quantifier, escape, char class, etc.
  return /[\\^$.*+?()[\]{}|]/.test(src);
}

/**
 * Compile a single serialized {@link PackerSignatureInput} into a runtime
 * {@link PackerSignature}.
 *
 * String patterns that look like regex (contain metacharacters or anchors)
 * are compiled with `i` flag; bare filenames stay as strings (fastest
 * matching path). Both paths reject ReDoS-shaped sources before any
 * `RegExp` is constructed.
 */
export function compileSignatureInput(input: PackerSignatureInput): PackerSignature {
  if (!input.name || input.name.length === 0) {
    throw makeValidation('customSignature.name must be a non-empty string');
  }
  if (!input.vendor || input.vendor.length === 0) {
    throw makeValidation('customSignature.vendor must be a non-empty string', { name: input.name });
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
    vendor: input.vendor,
    libPatterns: compiled,
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

/** Combine defaults and custom signatures per the requested {@link SignatureMode}. */
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
 * Post-hoc runtime ReDoS guard. Mirrors the dart-inspector classifier:
 * V8 cannot preempt a slow regex execution, so we measure elapsed time
 * after the fact and refuse to keep running once we have seen one over
 * budget.
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
