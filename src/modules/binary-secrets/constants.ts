/**
 * Centralized runtime-tunable constants for the binary-secrets domain.
 *
 * Every value can be overridden via the corresponding env var (loaded
 * from `.env` at startup) — mirrors the project-wide constants pattern.
 *
 * All "min/max" knobs are integers; `minEntropy` is stored as
 * `BINARY_SECRETS_MIN_ENTROPY_X10` (a fixed-point integer = 10 × the
 * desired Shannon entropy) so that env override stays parseable by
 * `parseInt` and avoids subtle locale-dependent float parsing.
 */

const int = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const intArray = (key: string, fallback: readonly number[]): readonly number[] => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const parts = v
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parts.length > 0 ? parts : fallback;
};

/**
 * Default decoded byte lengths to consider. Covers AES-128/192/256
 * (16/24/32) plus a few larger windows useful for asymmetric material.
 */
export const BINARY_SECRETS_DEFAULT_KEY_LENGTHS: readonly number[] = intArray(
  'BINARY_SECRETS_DEFAULT_KEY_LENGTHS',
  [16, 24, 32, 64],
);

/**
 * Maximum number of candidates returned by a single extract call.
 * Excess candidates are dropped after sorting; the result `truncated`
 * flag is set. Default: 500.
 */
export const BINARY_SECRETS_MAX_RESULTS = int('BINARY_SECRETS_MAX_RESULTS', 500);

/**
 * Default Shannon entropy floor for `raw` windows, stored as an integer
 * scaled ×10 (so `70` means an entropy ≥ 7.0). Range: `[0, 80]`.
 *
 * Storing this as an integer avoids env-var float parsing pitfalls and
 * keeps the override surface uniform with the other knobs.
 */
export const BINARY_SECRETS_MIN_ENTROPY_X10 = int('BINARY_SECRETS_MIN_ENTROPY_X10', 70);

/** Per-`.test()` budget enforced by the runtime ReDoS guard. Default: 50 ms. */
export const BINARY_SECRETS_REGEX_TIMEOUT_MS = int('BINARY_SECRETS_REGEX_TIMEOUT_MS', 50);

/**
 * Streaming chunk size in bytes. Larger chunks reduce overhead at the
 * cost of resident memory. Default: 16 MiB.
 */
export const BINARY_SECRETS_MAX_CHUNK_BYTES = int(
  'BINARY_SECRETS_MAX_CHUNK_BYTES',
  16 * 1024 * 1024,
);

/**
 * Tail bytes kept between consecutive chunks so candidates that span a
 * chunk boundary are still detected. Must exceed the largest possible
 * encoded candidate (default 1024 bytes ≫ 64-byte raw window × 2 for hex).
 */
export const BINARY_SECRETS_CHUNK_OVERLAP_BYTES = int('BINARY_SECRETS_CHUNK_OVERLAP_BYTES', 1024);

/** Default context window on each side of a candidate, in bytes. */
export const BINARY_SECRETS_CONTEXT_BYTES = int('BINARY_SECRETS_CONTEXT_BYTES', 16);

/** Maximum decoded bytes preserved in the `value` preview. Excess sets `valueTruncated`. */
export const BINARY_SECRETS_VALUE_PREVIEW_BYTES = int('BINARY_SECRETS_VALUE_PREVIEW_BYTES', 256);

/** Inclusive lower bound on Base64 encoded string length (≥ 24 chars ⇒ ≥ 18 raw bytes). */
export const BINARY_SECRETS_MIN_BASE64_LENGTH = int('BINARY_SECRETS_MIN_BASE64_LENGTH', 24);
/** Inclusive upper bound on Base64 encoded string length to bound regex work. */
export const BINARY_SECRETS_MAX_BASE64_LENGTH = int('BINARY_SECRETS_MAX_BASE64_LENGTH', 1024);

/** Inclusive lower bound on Hex string length (≥ 32 chars ⇒ ≥ 16 raw bytes). */
export const BINARY_SECRETS_MIN_HEX_LENGTH = int('BINARY_SECRETS_MIN_HEX_LENGTH', 32);
/** Inclusive upper bound on Hex string length to bound regex work. */
export const BINARY_SECRETS_MAX_HEX_LENGTH = int('BINARY_SECRETS_MAX_HEX_LENGTH', 1024);

/** Hard ceiling on total extract duration. Default: 60 s. */
export const BINARY_SECRETS_MAX_EXTRACT_DURATION_MS = int(
  'BINARY_SECRETS_MAX_EXTRACT_DURATION_MS',
  60_000,
);
