/**
 * Type definitions for the snapshot fingerprint module
 * (`dart_snapshot_header_parse` + `dart_version_fingerprint`).
 *
 * The shapes here mirror the public documentation of the Dart isolate
 * snapshot header — published in Phrack #71 (Aug 2024) and cross-checked
 * against the open-source `darter` and `reFlutter` projects. The parser
 * is intentionally read-only: no APK mutation, no payload, no dynamic
 * injection.
 *
 * @see openspec/changes/add-dart-snapshot-fingerprint/design.md
 */

/**
 * Snapshot magic word (`0xf5f5dcdc`) as written by the Dart VM in the
 * isolate snapshot data segment. Stored little-endian on disk; readers
 * compare via `readUInt32LE`.
 */
export const DART_SNAPSHOT_MAGIC = 0xf5f5dcdc;

/** Decoded `kind` field of the snapshot header. */
export type SnapshotKind = 'full' | 'full-aot' | 'full-jit' | 'full-core' | 'unknown';

/**
 * Target architecture inferred from the `features` string of the snapshot.
 * Dart writes one of `arm64 / arm / x64 / ia32 / riscv64` (plus other
 * feature tokens) into the snapshot. `'unknown'` is used when the parser
 * can not classify the binary.
 */
export type SnapshotArch = 'arm32' | 'arm64' | 'x64' | 'ia32' | 'riscv64' | 'unknown';

/** Where the parser found the snapshot header. */
export type SnapshotSource = 'symbol' | 'byte-scan';

/** Raw header fields. */
export interface SnapshotHeader {
  /** Magic number — always {@link DART_SNAPSHOT_MAGIC} when valid. */
  magic: number;
  kind: SnapshotKind;
  /** 32-byte snapshot identity hash, lowercase hex. */
  hash: string;
  /** Feature tokens split by whitespace (e.g. `['product', 'no-fp', 'arm64']`). */
  features: string[];
  targetArch: SnapshotArch;
  /** True when the `product` feature token is present. */
  isProduction: boolean;
  /** Absolute file offset (0-based) where the header was found. */
  fileOffset: number;
  /** How the header was located. */
  source: SnapshotSource;
}

/**
 * Snapshot header + (optional) version lookup result. When the hash is
 * not in any version table, {@link unknown} is `true` and the version
 * fields are absent (not empty strings) so callers can branch cleanly.
 */
export interface VersionFingerprint extends SnapshotHeader {
  flutterVersion?: string;
  engineCommit?: string;
  dartSdkRev?: string;
  releaseDate?: string;
  /** `true` when no entry matched the snapshot hash. */
  unknown: boolean;
}

/** Entry in the snapshot version table. */
export interface VersionEntry {
  flutterVersion: string;
  engineCommit?: string;
  dartSdkRev?: string;
  /** ISO 8601 date string, when known. */
  releaseDate?: string;
  /** ABIs the table author confirmed the entry on. Informational only. */
  abis?: ReadonlyArray<'arm32' | 'arm64' | 'x64' | 'ia32' | 'riscv64'>;
}

/** Options for {@link SnapshotFingerprint.parseHeader}. */
export interface ParseOptions {
  /**
   * Upper bound on the byte-scan fallback. Defaults to
   * `DART_SNAPSHOT_HEADER_SCAN_MAX_BYTES`. Must be `>= 0`.
   */
  maxScanBytes?: number;
}

/** Options for {@link SnapshotFingerprint.fingerprint}. */
export interface FingerprintOptions extends ParseOptions {
  /** When `false`, the response omits the {@link SnapshotHeader.features} array. */
  includeFeatures?: boolean;
  /** Override `DART_SNAPSHOT_TABLE_PATH`. */
  customTablePath?: string;
}
