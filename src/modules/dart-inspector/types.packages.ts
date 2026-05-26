/**
 * Type definitions for the flutter_packages_detect tool.
 *
 * @see openspec/changes/add-flutter-packages-detect/design.md §3.1
 */

/** Raw `package:` reference produced by {@link StringsExtractor.extractFromFile}. */
export interface PackageRef {
  /** Full `package:foo/bar.dart` string. */
  value: string;
  /** Optional byte offsets in the source binary (sorted ascending). */
  offsets?: number[];
}

/** Aggregated information for a single Dart/Flutter package. */
export interface PackageEntry {
  /** Package name (e.g. `dio`, `flutter`, `sky_engine`). */
  name: string;
  /** Whether the package belongs to the Flutter SDK whitelist (or `extraStdlibPackages`). */
  isFlutterStdlib: boolean;
  /** Total number of references — counts duplicates of the same file path. */
  occurrenceCount: number;
  /** Distinct `package:<name>/...` file references in order of first appearance. */
  files?: string[];
  /** True when {@link files} was capped at `maxFilesPerPackage`. */
  filesTruncated?: boolean;
  /**
   * Sorted, deduplicated byte offsets aggregated across every reference of
   * this package. Only populated when `includeOffsets: true`.
   */
  offsets?: number[];
}

/** Final aggregation result returned by {@link PackageDetector}. */
export interface PackageReport {
  /** Packages sorted alphabetically by `name`. */
  packages: PackageEntry[];
  /** Number of entries in {@link packages} (post-filter, post-truncation). */
  total: number;
  /** Number of stdlib packages found pre-filter (informational). */
  flutterStdlibCount: number;
  /** Number of non-stdlib packages found pre-filter (informational). */
  thirdPartyCount: number;
  /** Total bytes considered (only meaningful when the detector scanned a file). */
  scannedBytes?: number;
  /** Wall-clock duration of the detect() call in milliseconds. */
  durationMs: number;
  /** True when {@link packages} was capped at `maxPackages`. */
  truncated?: boolean;
}

/** Input options for {@link PackageDetector.detect}. */
export interface PackageDetectOptions {
  /**
   * Absolute path to the source binary (libapp.so). Required when
   * {@link packageRefs} is not provided.
   */
  filePath?: string;
  /**
   * Pre-extracted `package:` references. When provided the detector skips
   * scanning the binary and aggregates these directly.
   */
  packageRefs?: ReadonlyArray<string | PackageRef>;
  /** Default: `false`. When `true`, stdlib packages are kept in the result. */
  includeFlutterStdlib?: boolean;
  /** Default: `true`. When `false`, {@link PackageEntry.files} is stripped. */
  includeFiles?: boolean;
  /** Default: `false`. When `true`, {@link PackageEntry.offsets} is populated. */
  includeOffsets?: boolean;
  /** Per-package file cap. Default: {@link DART_MAX_FILES_PER_PACKAGE}. */
  maxFilesPerPackage?: number;
  /** Global package cap. Default: {@link DART_MAX_PACKAGES_PER_RESULT}. */
  maxPackages?: number;
  /** Additional package names to treat as stdlib (case-sensitive, lowercase). */
  extraStdlibPackages?: readonly string[];
}
