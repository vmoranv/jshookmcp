/**
 * Centralized runtime-tunable constants for the apk-packer domain.
 *
 * Every value can be overridden via the corresponding env var (loaded
 * from `.env` at startup) — mirrors the project-wide constants pattern.
 */

const int = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Maximum APK size accepted by `detectFromApk`. Larger inputs are
 * rejected before the ZIP central directory walk to avoid pathological
 * memory use. Default: 512 MiB.
 */
export const APK_PACKER_MAX_APK_BYTES = int('APK_PACKER_MAX_APK_BYTES', 512 * 1024 * 1024);

/**
 * Maximum number of ZIP entries enumerated per APK. Hardens against
 * zip-bomb-style central directory abuse. Default: 200_000.
 */
export const APK_PACKER_MAX_ZIP_ENTRIES = int('APK_PACKER_MAX_ZIP_ENTRIES', 200_000);

/**
 * Cap on a single user-supplied regex source length, in characters.
 * Limits parse cost + ReDoS surface. Default: 256.
 */
export const APK_PACKER_MAX_REGEX_PATTERN_LENGTH = int('APK_PACKER_MAX_REGEX_PATTERN_LENGTH', 256);

/**
 * Per-`.test()` budget enforced by the post-hoc ReDoS guard. Default: 50 ms.
 */
export const APK_PACKER_REGEX_TIMEOUT_MS = int('APK_PACKER_REGEX_TIMEOUT_MS', 50);

/**
 * APK Signing Block — tail-window scanned for EOCD magic. AOSP allows a
 * ZIP comment up to 65535 bytes, plus a 22-byte EOCD record = 65557. We
 * read at most this many trailing bytes when looking for the central
 * directory offset. Default: 65557.
 */
export const APK_SIGBLOCK_EOCD_SCAN_BYTES = int('APK_SIGBLOCK_EOCD_SCAN_BYTES', 65_557);

/**
 * Hard ceiling on the Signing Block size we will read into memory. AOSP
 * imposes no formal limit; we cap at 16 MiB to avoid OOM on hostile APK.
 * Default: 16 MiB.
 */
export const APK_SIGBLOCK_MAX_BYTES = int('APK_SIGBLOCK_MAX_BYTES', 16 * 1024 * 1024);

/**
 * Number of bytes from the file head scanned for the DEX-prefix heuristic
 * (DEX magic injected before the ZIP local file headers). Default: 4096.
 */
export const APK_SIGBLOCK_DEX_PREFIX_HEAD_BYTES = int('APK_SIGBLOCK_DEX_PREFIX_HEAD_BYTES', 4096);
