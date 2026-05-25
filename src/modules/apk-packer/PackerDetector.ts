/**
 * PackerDetector — match an APK (or an unpacked APK directory) against
 * the built-in {@link DEFAULT_SIGNATURES} fingerprint database, plus any
 * user-supplied custom signatures.
 *
 * Implementation contract:
 *   - **No payload, no shellcode, no unpacking** — only filename matching.
 *   - APK input is parsed with `yauzl` in lazy-entry mode; we enumerate
 *     the central directory and inspect basenames of `lib/<abi>/*.so`
 *     entries. The streams are never opened.
 *   - Directory input walks the on-disk `lib/` tree (allows tests to
 *     skip ZIP parsing entirely).
 *   - User-supplied custom signatures pass through {@link compileSignatureInput},
 *     which rejects ReDoS-shaped patterns and over-long sources before
 *     a `RegExp` is constructed.
 */

import { stat } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  open as openZipArchive,
  type Entry as ZipEntry,
  type ZipFile as YauzlZipFile,
} from 'yauzl';

import { ToolError } from '@errors/ToolError';

import {
  APK_PACKER_MAX_APK_BYTES,
  APK_PACKER_MAX_ZIP_ENTRIES,
  APK_PACKER_REGEX_TIMEOUT_MS,
} from './constants';
import { DEFAULT_SIGNATURES } from './fingerprints';
import { mergeSignatures, testPatternTimed } from './classifiers';
import type { DetectionResult, DetectOptions, PackerMatch, PackerSignature } from './types';

const LIB_PATH_RE = /^lib\/[^/]+\/(lib[^/]+\.so)$/i;

/** Match an APK or an extracted APK directory against vendor packer signatures. */
export class PackerDetector {
  constructor(private readonly defaults: readonly PackerSignature[] = DEFAULT_SIGNATURES) {}

  /** Scan a packaged `.apk` (or `.aab`) ZIP archive. */
  async detectFromApk(apkPath: string, opts: DetectOptions = {}): Promise<DetectionResult> {
    if (!apkPath || apkPath.length === 0) {
      throw new ToolError('VALIDATION', 'apkPath must be a non-empty string');
    }

    let stats;
    try {
      stats = await stat(apkPath);
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `APK not found: ${apkPath}`, {
        details: { apkPath },
        cause: cause as Error,
      });
    }
    if (!stats.isFile()) {
      throw new ToolError('VALIDATION', `APK path is not a regular file: ${apkPath}`, {
        details: { apkPath },
      });
    }
    if (stats.size > APK_PACKER_MAX_APK_BYTES) {
      throw new ToolError(
        'VALIDATION',
        `APK exceeds APK_PACKER_MAX_APK_BYTES (${APK_PACKER_MAX_APK_BYTES} bytes): ${stats.size}`,
        { details: { apkPath, size: stats.size, max: APK_PACKER_MAX_APK_BYTES } },
      );
    }

    const libBasenames = await listLibBasenamesFromApk(apkPath);
    return this.matchBasenames(libBasenames, opts);
  }

  /** Scan a directory containing an unpacked APK (or any tree with `lib/<abi>/*.so`). */
  async detectFromDir(dirPath: string, opts: DetectOptions = {}): Promise<DetectionResult> {
    if (!dirPath || dirPath.length === 0) {
      throw new ToolError('VALIDATION', 'dirPath must be a non-empty string');
    }

    let stats;
    try {
      stats = await stat(dirPath);
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `Directory not found: ${dirPath}`, {
        details: { dirPath },
        cause: cause as Error,
      });
    }
    if (!stats.isDirectory()) {
      throw new ToolError('VALIDATION', `Path is not a directory: ${dirPath}`, {
        details: { dirPath },
      });
    }

    const libBasenames = await listLibBasenamesFromDir(dirPath);
    return this.matchBasenames(libBasenames, opts);
  }

  /**
   * Match a pre-collected list of `lib/<abi>/<basename>` entries against
   * the active signature chain. Exposed for callers that want to reuse a
   * file listing they already have.
   */
  matchBasenames(libs: readonly LibEntry[], opts: DetectOptions = {}): DetectionResult {
    const signatures = mergeSignatures(
      this.defaults,
      opts.customSignatures,
      opts.ruleMode ?? 'append',
    );

    const matches: PackerMatch[] = [];

    for (const sig of signatures) {
      const matchedLibs = new Set<string>();
      for (const lib of libs) {
        if (libMatchesSignature(lib, sig)) {
          matchedLibs.add(lib.path);
        }
      }
      if (matchedLibs.size === 0) continue;
      const baseConfidence = sig.confidence ?? 'medium';
      const confidence: 'high' | 'medium' | 'low' = matchedLibs.size >= 2 ? 'high' : baseConfidence;
      matches.push({
        name: sig.name,
        vendor: sig.vendor,
        matchedLibs: [...matchedLibs].toSorted(),
        confidence,
      });
    }

    const layerCount = matches.length;
    const confidenceScore = aggregateConfidence(matches);
    return { packers: matches, confidence: confidenceScore, layerCount };
  }
}

/** Internal — one `lib/<abi>/<basename>` entry. */
export interface LibEntry {
  /** Full path inside the APK (or relative to the apk-root directory), lowercase. */
  readonly path: string;
  /** Basename only, lowercase. */
  readonly basename: string;
}

function libMatchesSignature(lib: LibEntry, sig: PackerSignature): boolean {
  for (const pat of sig.libPatterns) {
    if (typeof pat === 'string') {
      if (lib.basename === pat) return true;
    } else if (testPatternTimed(pat, lib.basename, APK_PACKER_REGEX_TIMEOUT_MS, sig.name)) {
      return true;
    }
  }
  return false;
}

function aggregateConfidence(matches: readonly PackerMatch[]): number {
  if (matches.length === 0) return 0;
  // 0.5 for any hit, +0.25 if ≥ one high-confidence match, +0.25 for ≥2 layers.
  let score = 0.5;
  if (matches.some((m) => m.confidence === 'high')) score += 0.25;
  if (matches.length >= 2) score += 0.25;
  return Math.min(score, 1);
}

/**
 * Enumerate `lib/<abi>/*.so` entries in an APK via yauzl. We only look at
 * basenames — streams are never opened.
 */
async function listLibBasenamesFromApk(apkPath: string): Promise<LibEntry[]> {
  return new Promise<LibEntry[]>((resolve, reject) => {
    openZipArchive(apkPath, { lazyEntries: true, autoClose: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(
          new ToolError('VALIDATION', `Failed to open APK as ZIP: ${err?.message ?? 'unknown'}`, {
            details: { apkPath },
            cause: err ?? undefined,
          }),
        );
        return;
      }
      const collected: LibEntry[] = [];
      let entryCount = 0;
      const zip = zipFile as YauzlZipFile;
      const onEntry = (entry: ZipEntry) => {
        entryCount += 1;
        if (entryCount > APK_PACKER_MAX_ZIP_ENTRIES) {
          zip.close();
          reject(
            new ToolError(
              'VALIDATION',
              `APK has too many ZIP entries (> ${APK_PACKER_MAX_ZIP_ENTRIES})`,
              { details: { apkPath } },
            ),
          );
          return;
        }
        const fileName = entry.fileName;
        const match = LIB_PATH_RE.exec(fileName);
        if (match) {
          const base = (match[1] as string).toLowerCase();
          collected.push({ path: fileName.toLowerCase(), basename: base });
        }
        zip.readEntry();
      };
      const onEnd = () => {
        cleanup();
        resolve(collected);
      };
      const onError = (e: Error) => {
        cleanup();
        reject(
          new ToolError('RUNTIME', `ZIP read failed: ${e.message}`, {
            details: { apkPath },
            cause: e,
          }),
        );
      };
      function cleanup() {
        zip.removeListener('entry', onEntry);
        zip.removeListener('end', onEnd);
        zip.removeListener('error', onError);
      }
      zip.on('entry', onEntry);
      zip.on('end', onEnd);
      zip.on('error', onError);
      zip.readEntry();
    });
  });
}

/** Walk `lib/<abi>/*.so` under an unpacked APK directory. */
async function listLibBasenamesFromDir(dirPath: string): Promise<LibEntry[]> {
  const libRoot = join(dirPath, 'lib');
  let abiDirs: string[];
  try {
    abiDirs = await readdir(libRoot);
  } catch {
    // No lib/ directory at all → no matches; that's a valid "no packer".
    return [];
  }

  const out: LibEntry[] = [];
  for (const abi of abiDirs) {
    const abiDir = join(libRoot, abi);
    let entries: string[];
    try {
      const dirStat = await stat(abiDir);
      if (!dirStat.isDirectory()) continue;
      entries = await readdir(abiDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.so')) continue;
      const relPath = `lib/${abi}/${name}`.toLowerCase();
      out.push({ path: relPath, basename: basename(name).toLowerCase() });
    }
  }
  return out;
}
