/**
 * PackageDetector — aggregate `package:` references from a Flutter AOT
 * `libapp.so` (or a pre-extracted list) into a deduplicated package report.
 *
 * Two operating modes:
 *   1. **Scan mode** — given `filePath`, run {@link StringsExtractor} once
 *      and pull out the `packageRefs` category.
 *   2. **Aggregate mode** — given a `packageRefs[]` list, skip the scan.
 *
 * 100% read-only static analysis. Never opens, executes, or writes the binary
 * — only the byte stream is consumed.
 *
 * @see openspec/changes/add-flutter-packages-detect/design.md §3.3
 */

import { stat } from 'node:fs/promises';

import { DART_MAX_FILES_PER_PACKAGE, DART_MAX_PACKAGES_PER_RESULT } from '@src/constants';
import { ToolError } from '@errors/ToolError';

import { StringsExtractor } from './StringsExtractor';
import { isStdlibPackage } from './flutter-stdlib-packages';
import type {
  PackageDetectOptions,
  PackageEntry,
  PackageRef,
  PackageReport,
} from './types.packages';

/**
 * `package:foo/path/to/file.dart` — pinned to the same shape used by the
 * default classifier rule in `classifiers.ts` (`packageRefs`). The capture
 * group isolates the package name; the body is preserved as the full ref.
 */
const PACKAGE_REF_REGEX = /^package:([a-z_][a-z0-9_]*)\/([a-z0-9_./]+\.dart)$/i;

/** Internal mutable accumulator before we freeze into the final {@link PackageEntry}. */
interface MutableEntry {
  name: string;
  isFlutterStdlib: boolean;
  occurrenceCount: number;
  /** Insert-ordered file refs; matched by {@link filesSet} for O(1) duplicate detection. */
  files: string[];
  filesSet: Set<string>;
  filesTruncated: boolean;
  /** Sorted, deduplicated offset list. */
  offsets: number[];
  offsetsSet: Set<number>;
}

export class PackageDetector {
  constructor(private readonly extractor: StringsExtractor = new StringsExtractor()) {}

  /**
   * Detect packages in either scan or aggregate mode.
   *
   * Throws {@link ToolError} for:
   *  - `VALIDATION` — neither `filePath` nor `packageRefs` provided, or invalid options
   *  - `NOT_FOUND` — `filePath` does not exist
   */
  async detect(opts: PackageDetectOptions): Promise<PackageReport> {
    validateOptions(opts);

    const startedAt = Date.now();
    let scannedBytes: number | undefined;
    let refs: ReadonlyArray<PackageRef>;

    if (opts.packageRefs !== undefined) {
      refs = normalizeRefs(opts.packageRefs);
    } else if (opts.filePath !== undefined) {
      try {
        scannedBytes = (await stat(opts.filePath)).size;
      } catch (cause) {
        throw new ToolError('NOT_FOUND', `File not found: ${opts.filePath}`, {
          details: { filePath: opts.filePath },
          cause: cause as Error,
        });
      }
      const extracted = await this.extractor.extractFromFile(opts.filePath, {});
      const bucket = extracted['packageRefs'] ?? [];
      refs = bucket.map((s) => ({ value: s.value, offsets: s.offsets }));
    } else {
      // Defensive — validateOptions() already covers this branch.
      throw new ToolError('VALIDATION', 'Either filePath or packageRefs must be provided');
    }

    const extra = new Set(opts.extraStdlibPackages ?? []);
    const aggregated = PackageDetector.aggregate(refs, {
      includeFlutterStdlib: opts.includeFlutterStdlib ?? false,
      includeFiles: opts.includeFiles ?? true,
      includeOffsets: opts.includeOffsets ?? false,
      maxFilesPerPackage: opts.maxFilesPerPackage ?? DART_MAX_FILES_PER_PACKAGE,
      maxPackages: opts.maxPackages ?? DART_MAX_PACKAGES_PER_RESULT,
      extra,
    });

    const report: PackageReport = {
      ...aggregated,
      durationMs: Date.now() - startedAt,
    };
    if (scannedBytes !== undefined) {
      report.scannedBytes = scannedBytes;
    }
    return report;
  }

  /**
   * Pure aggregation step — exposed for unit tests that want to bypass file IO.
   *
   * Algorithm:
   *  1. Walk every ref. Skip strings that fail {@link PACKAGE_REF_REGEX}.
   *  2. Group by package name into a {@link MutableEntry}.
   *  3. Increment `occurrenceCount` for every ref (counts duplicates).
   *  4. Add the full `package:` string to `files` on first sight; track
   *     `filesTruncated` when the per-package cap is hit.
   *  5. Merge offsets into the entry's sorted/dedup'd offset list.
   *  6. After all refs: count stdlib vs third-party (before filtering),
   *     filter out stdlib when `!includeFlutterStdlib`, sort by name,
   *     truncate to `maxPackages` and mark `truncated: true` on overflow.
   */
  static aggregate(
    refs: ReadonlyArray<PackageRef>,
    options: {
      includeFlutterStdlib: boolean;
      includeFiles: boolean;
      includeOffsets: boolean;
      maxFilesPerPackage: number;
      maxPackages: number;
      extra: ReadonlySet<string>;
    },
  ): Omit<PackageReport, 'durationMs' | 'scannedBytes'> {
    const {
      includeFlutterStdlib,
      includeFiles,
      includeOffsets,
      maxFilesPerPackage,
      maxPackages,
      extra,
    } = options;

    const map = new Map<string, MutableEntry>();

    for (const ref of refs) {
      const parsed = parsePackageRef(ref.value);
      if (!parsed) continue;
      const { name } = parsed;

      let entry = map.get(name);
      if (!entry) {
        entry = {
          name,
          isFlutterStdlib: isStdlibPackage(name, extra),
          occurrenceCount: 0,
          files: [],
          filesSet: new Set(),
          filesTruncated: false,
          offsets: [],
          offsetsSet: new Set(),
        };
        map.set(name, entry);
      }
      entry.occurrenceCount += 1;

      if (includeFiles) {
        if (!entry.filesSet.has(ref.value)) {
          if (entry.files.length < maxFilesPerPackage) {
            entry.files.push(ref.value);
            entry.filesSet.add(ref.value);
          } else {
            entry.filesTruncated = true;
          }
        }
      }

      if (includeOffsets && ref.offsets && ref.offsets.length > 0) {
        for (const off of ref.offsets) {
          if (!entry.offsetsSet.has(off)) {
            entry.offsetsSet.add(off);
            insertSortedUnique(entry.offsets, off);
          }
        }
      }
    }

    // Count BEFORE filtering — callers want the global census.
    let flutterStdlibCount = 0;
    let thirdPartyCount = 0;
    for (const entry of map.values()) {
      if (entry.isFlutterStdlib) flutterStdlibCount += 1;
      else thirdPartyCount += 1;
    }

    // Filter stdlib (default) and shape mutable -> public entries.
    const sorted: PackageEntry[] = [];
    for (const entry of map.values()) {
      if (!includeFlutterStdlib && entry.isFlutterStdlib) continue;
      sorted.push(buildEntry(entry, includeFiles, includeOffsets));
    }
    sorted.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    let truncated = false;
    let packages = sorted;
    if (sorted.length > maxPackages) {
      truncated = true;
      packages = sorted.slice(0, maxPackages);
    }

    const result: Omit<PackageReport, 'durationMs' | 'scannedBytes'> = {
      packages,
      total: packages.length,
      flutterStdlibCount,
      thirdPartyCount,
    };
    if (truncated) result.truncated = true;
    return result;
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function validateOptions(opts: PackageDetectOptions): void {
  if (opts.packageRefs === undefined && (opts.filePath === undefined || opts.filePath === '')) {
    throw new ToolError(
      'VALIDATION',
      'PackageDetector.detect requires either filePath or packageRefs',
    );
  }
  if (opts.maxFilesPerPackage !== undefined) {
    if (!Number.isInteger(opts.maxFilesPerPackage) || opts.maxFilesPerPackage < 1) {
      throw new ToolError(
        'VALIDATION',
        `maxFilesPerPackage must be a positive integer (got ${opts.maxFilesPerPackage})`,
      );
    }
  }
  if (opts.maxPackages !== undefined) {
    if (!Number.isInteger(opts.maxPackages) || opts.maxPackages < 1) {
      throw new ToolError(
        'VALIDATION',
        `maxPackages must be a positive integer (got ${opts.maxPackages})`,
      );
    }
  }
  if (opts.extraStdlibPackages !== undefined) {
    if (!Array.isArray(opts.extraStdlibPackages)) {
      throw new ToolError('VALIDATION', 'extraStdlibPackages must be an array of strings');
    }
    for (let i = 0; i < opts.extraStdlibPackages.length; i += 1) {
      const v = opts.extraStdlibPackages[i];
      if (typeof v !== 'string' || v.length === 0 || v.length > 128) {
        throw new ToolError(
          'VALIDATION',
          `extraStdlibPackages[${i}] must be a non-empty string of ≤128 chars`,
        );
      }
    }
  }
}

function normalizeRefs(refs: ReadonlyArray<string | PackageRef>): ReadonlyArray<PackageRef> {
  return refs.map((r) => (typeof r === 'string' ? { value: r } : r));
}

interface ParsedRef {
  name: string;
}

function parsePackageRef(value: string): ParsedRef | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const m = PACKAGE_REF_REGEX.exec(value);
  if (!m || !m[1]) return undefined;
  return { name: m[1].toLowerCase() };
}

function buildEntry(
  entry: MutableEntry,
  includeFiles: boolean,
  includeOffsets: boolean,
): PackageEntry {
  const out: PackageEntry = {
    name: entry.name,
    isFlutterStdlib: entry.isFlutterStdlib,
    occurrenceCount: entry.occurrenceCount,
  };
  if (includeFiles) {
    out.files = entry.files.slice();
    if (entry.filesTruncated) out.filesTruncated = true;
  }
  if (includeOffsets && entry.offsets.length > 0) {
    out.offsets = entry.offsets.slice();
  }
  return out;
}

function insertSortedUnique(sorted: number[], value: number): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const at = sorted[mid] as number;
    if (at === value) return;
    if (at < value) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}
