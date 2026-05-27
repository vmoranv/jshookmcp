/**
 * Type definitions for the apk-packer module.
 *
 * Purely declarative — no payload, no shellcode, no unpacking.
 * Signatures match against `lib/<abi>/lib*.so` filenames inside an APK
 * (or an unpacked APK directory tree).
 */

/** Confidence tier produced by the matcher. */
export type PackerConfidence = 'high' | 'medium' | 'low';

/**
 * Compiled fingerprint used internally by the detector.
 *
 * `libPatterns` may contain either:
 *   - a literal lowercase filename
 *   - a `RegExp`
 *
 * Multiple distinct hits across patterns escalate confidence
 * (single hit → medium, ≥2 hits → high).
 */
export interface PackerSignature {
  /** Display name of the fingerprint entry. */
  readonly name: string;
  /** Optional free-form category label supplied by the caller. */
  readonly category?: string;
  /** Patterns evaluated against `lib/<abi>/<filename>` basenames. */
  readonly libPatterns: readonly (string | RegExp)[];
  /**
   * Optional confidence override for single-pattern hits. Defaults to
   * `medium` when omitted; matchers with ≥2 distinct lib hits always
   * escalate to `high` regardless of this hint.
   */
  readonly confidence?: PackerConfidence;
  /** Optional notes for the user-facing list-signatures tool. */
  readonly notes?: string;
}

/**
 * Serializable input form accepted via MCP tool customSignatures field.
 *
 * `libPatterns` are strings here; the loader compiles to RegExp when the
 * source starts with `^` or contains regex metacharacters, otherwise
 * treats it as a literal lowercase filename.
 */
export interface PackerSignatureInput {
  readonly name: string;
  readonly category?: string;
  readonly libPatterns: readonly string[];
  readonly confidence?: PackerConfidence;
  readonly notes?: string;
}

/** A single packer match produced by the detector. */
export interface PackerMatch {
  readonly name: string;
  readonly category?: string;
  readonly matchedLibs: readonly string[];
  readonly confidence: PackerConfidence;
}

/** Result of a detection run. */
export interface DetectionResult {
  readonly packers: readonly PackerMatch[];
  /** Aggregate confidence score [0, 1] based on the strongest match. */
  readonly confidence: number;
  /** How many distinct packers were matched (>1 == nested/multi-layer). */
  readonly layerCount: number;
}

/** How `customSignatures` interact with the built-in `DEFAULT_SIGNATURES`. */
export type SignatureMode = 'append' | 'prepend' | 'replace';

/** Options accepted by the detector. */
export interface DetectOptions {
  readonly customSignatures?: readonly PackerSignature[];
  readonly ruleMode?: SignatureMode;
}
