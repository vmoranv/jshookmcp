/**
 * Default fingerprint table for the apk-packer module.
 *
 * The framework ships **no** built-in fingerprints. All signatures used at
 * detection time come from the caller via the customSignatures argument
 * of apk_packer_detect (compiled through compileSignatureInput with
 * ReDoS-safe regex compilation).
 *
 * Filename matching is case-insensitive; the detector lowercases inputs.
 */

import type { PackerSignature } from './types';

/**
 * Default fingerprint table - intentionally empty.
 *
 * Each libPatterns entry supplied by callers is either:
 *   - a lowercase literal filename (fastest, equality match)
 *   - a RegExp anchored against the basename
 */
export const DEFAULT_SIGNATURES: readonly PackerSignature[] = Object.freeze([]);
