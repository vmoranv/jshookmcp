/**
 * Type definitions for the binary-secrets module.
 *
 * Purely declarative — no payload, no shellcode, no decryption.
 *
 * The module scans a binary file and emits {@link KeyCandidate}s whose
 * bytes resemble a hardcoded symmetric key, an embedded Base64 string,
 * or an embedded hex string. **Candidates are not validated.** A human
 * reviewer must verify whether any given candidate is a real key.
 */

/** Format dimension of a candidate hit. */
export type KeyFormat = 'raw' | 'base64' | 'hex';

/** Short ASCII context window around a candidate. */
export interface KeyCandidateContext {
  /** Hex-encoded bytes immediately before the candidate (length ≤ contextBytes * 2). */
  readonly before: string;
  /** Hex-encoded bytes immediately after the candidate (length ≤ contextBytes * 2). */
  readonly after: string;
  /** ASCII rendering of the same `before` window (non-printable → `.`). */
  readonly beforeAscii: string;
  /** ASCII rendering of the same `after` window (non-printable → `.`). */
  readonly afterAscii: string;
}

/** A single candidate emitted by {@link KeyExtractor}. */
export interface KeyCandidate {
  /** Byte offset in the source file where the candidate begins. */
  readonly offset: number;
  /**
   * Byte length of the candidate. For `raw` this is the window size;
   * for `base64`/`hex` this is the **decoded** byte length (so a hex
   * string of 64 chars reports `length: 32`).
   */
  readonly length: number;
  /** The format dimension the candidate matched. */
  readonly format: KeyFormat;
  /**
   * Shannon entropy of the candidate's raw bytes, in the [0, 8] range.
   * For `base64`/`hex` candidates this is the entropy of the **decoded**
   * bytes, not the encoded string itself.
   */
  readonly entropy: number;
  /** Hex preview of the candidate bytes (decoded for base64/hex). */
  readonly value: string;
  /** True when the value preview was truncated to VALUE_PREVIEW_BYTES. */
  readonly valueTruncated?: boolean;
  /** Optional surrounding bytes (omitted when `includeContext: false`). */
  readonly context?: KeyCandidateContext;
}

/** Options accepted by {@link KeyExtractor.extractFromFile}. */
export interface ExtractKeysOptions {
  /**
   * Decoded byte lengths to consider. For `raw` mode this is the
   * sliding-window size; for `base64`/`hex` this filters candidates
   * whose **decoded** length matches one of the listed values.
   * Defaults to BINARY_SECRETS_DEFAULT_KEY_LENGTHS.
   */
  readonly keyLengths?: readonly number[];
  /**
   * Inclusive minimum Shannon entropy of a `raw` window. Floats in
   * [0, 8]. Defaults to BINARY_SECRETS_MIN_ENTROPY_X10 / 10.
   */
  readonly minEntropy?: number;
  /**
   * Which format dimensions to scan. Defaults to all three.
   */
  readonly formats?: readonly KeyFormat[];
  /** Whether to attach a context window to each candidate (default: true). */
  readonly includeContext?: boolean;
  /** Size of the context window on each side, in bytes (default: 16). */
  readonly contextBytes?: number;
  /**
   * Maximum number of candidates returned. Excess candidates are dropped
   * after sorting and the result `truncated` flag is set.
   * Defaults to BINARY_SECRETS_MAX_RESULTS.
   */
  readonly maxResults?: number;
  /** Streaming chunk size in bytes. Defaults to BINARY_SECRETS_MAX_CHUNK_BYTES. */
  readonly maxChunkBytes?: number;
  /**
   * Restrict scanning to a byte window. Both bounds clamp to the file size.
   */
  readonly scanWindow?: { readonly start?: number; readonly end?: number };
}

/** Result returned by {@link KeyExtractor.extractFromFile}. */
export interface ExtractKeysResult {
  /** Candidates sorted by entropy desc, offset asc. */
  readonly candidates: readonly KeyCandidate[];
  /** Total bytes scanned (after applying scanWindow). */
  readonly scannedBytes: number;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  /** True when more candidates than maxResults were produced. */
  readonly truncated?: boolean;
}
