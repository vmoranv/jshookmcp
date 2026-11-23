import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getArtifactDir, getArtifactsRoot, type ArtifactCategory } from '@utils/artifacts';
import { getConfig } from '@utils/config';
import { getDebuggerSessionsDir, getProjectRoot, getSafeOutputRoots } from '@utils/outputPaths';
import { logger } from '@utils/logger';
import { readEnvBoolean, readEnvInteger } from '@src/config/environment';

export interface ArtifactRetentionConfig {
  enabled: boolean;
  retentionDays: number;
  maxTotalBytes: number;
  cleanupOnStart: boolean;
  cleanupIntervalMinutes: number;
}

export interface ArtifactCleanupResult {
  success: boolean;
  scannedFiles: number;
  removedFiles: number;
  removedBytes: number;
  removedByAge: number;
  removedBySize: number;
  /** Candidates whose removal was vetoed/failed (changed since scan, I/O error). */
  failedRemovals: number;
  remainingFiles: number;
  remainingBytes: number;
  dryRun: boolean;
  directories: string[];
  categories?: ArtifactCategory[];
  excludeCategories?: ArtifactCategory[];
  removedSample: string[];
  config: ArtifactRetentionConfig;
}

interface ArtifactFileEntry {
  path: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// a4-06: retention used to default to disabled (env ?? '0'), letting artifacts
// accumulate without bound until the disk filled and every write downstream
// failed. The scheduler now runs by default — a 7-day age window swept every
// 6 hours — with an unref'd timer so it never blocks process exit. Setting an
// env var explicitly to '0' still disables the corresponding knob.
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_CLEANUP_INTERVAL_MINUTES = 360;
const MANAGED_ARTIFACT_CATEGORIES: readonly ArtifactCategory[] = Object.freeze([
  'wasm',
  'traces',
  'profiles',
  'dumps',
  'reports',
  'har',
  'captures',
  'sessions',
  'offloaded',
  'tmp',
  'heap-snapshots',
]);

export function getArtifactRetentionConfig(env?: NodeJS.ProcessEnv): ArtifactRetentionConfig {
  const retentionDays = Math.max(
    0,
    readEnvInteger('MCP_ARTIFACT_RETENTION_DAYS', DEFAULT_RETENTION_DAYS, { env }),
  );
  const maxTotalMb = Math.max(0, readEnvInteger('MCP_ARTIFACT_MAX_TOTAL_MB', 0, { env }));
  const cleanupIntervalMinutes = Math.max(
    0,
    readEnvInteger('MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES', DEFAULT_CLEANUP_INTERVAL_MINUTES, {
      env,
    }),
  );
  const cleanupOnStart = readEnvBoolean('MCP_ARTIFACT_CLEANUP_ON_START', false, { env });
  return {
    enabled: retentionDays > 0 || maxTotalMb > 0,
    retentionDays,
    maxTotalBytes: maxTotalMb * 1024 * 1024,
    cleanupOnStart,
    cleanupIntervalMinutes,
  };
}

// Serializes concurrent cleanup runs: two overlapping cleanups scanning and
// removing the same tree would double-count files and race each other's rm.
let cleanupQueue: Promise<void> = Promise.resolve();

export async function cleanupArtifacts(options?: {
  retentionDays?: number;
  maxTotalBytes?: number;
  dryRun?: boolean;
  now?: number;
  directories?: string[];
  categories?: ArtifactCategory[];
  excludeCategories?: ArtifactCategory[];
}): Promise<ArtifactCleanupResult> {
  const previous = cleanupQueue;
  let release!: () => void;
  cleanupQueue = new Promise<void>((releaseQueue) => {
    release = releaseQueue;
  });
  await previous;
  try {
    return await performCleanup(options);
  } finally {
    release();
  }
}

async function performCleanup(options?: {
  retentionDays?: number;
  maxTotalBytes?: number;
  dryRun?: boolean;
  now?: number;
  directories?: string[];
  categories?: ArtifactCategory[];
  excludeCategories?: ArtifactCategory[];
}): Promise<ArtifactCleanupResult> {
  const envConfig = getArtifactRetentionConfig();
  const config: ArtifactRetentionConfig = {
    ...envConfig,
    retentionDays: options?.retentionDays ?? envConfig.retentionDays,
    maxTotalBytes: options?.maxTotalBytes ?? envConfig.maxTotalBytes,
  };

  const now = options?.now ?? Date.now();
  const dryRun = options?.dryRun ?? false;
  const categories = normalizeCategories(options?.categories);
  const excludeCategories = normalizeCategories(options?.excludeCategories);
  const directories =
    options?.directories !== undefined
      ? resolveCallerDirectories(options.directories)
      : getManagedArtifactDirectories({
          categories,
          excludeCategories,
        });

  const cutoff = config.retentionDays > 0 ? now - config.retentionDays * DAY_MS : 0;
  let scannedFiles = 0;
  let removedFiles = 0;
  let removedBytes = 0;
  let removedByAge = 0;
  let removedBySize = 0;
  const remaining: ArtifactFileEntry[] = [];
  const failedRemovals: ArtifactFileEntry[] = [];
  const removedSample: string[] = [];
  const root = getProjectRoot();
  const pendingRemovals: Promise<void>[] = [];

  function countRemoval(entry: ArtifactFileEntry, reason: 'age' | 'size'): void {
    removedFiles++;
    removedBytes += entry.size;
    if (reason === 'age') removedByAge += entry.size;
    else removedBySize += entry.size;
    if (removedSample.length < 20) removedSample.push(entry.relativePath);
  }

  // Schedule the destructive rm only after a post-check re-stat proves the
  // file is unchanged since the scan-time snapshot; the counters follow the
  // actual outcome, not the scan-time candidate.
  function scheduleRemoval(entry: ArtifactFileEntry, reason: 'age' | 'size'): void {
    pendingRemovals.push(
      removeFileIfUnchanged(entry.path, entry.mtimeMs, entry.size)
        .then((removed) => {
          if (removed) countRemoval(entry, reason);
          else failedRemovals.push(entry);
        })
        .catch(() => {
          failedRemovals.push(entry);
        }),
    );
  }

  // Stream-based: process each file as it's discovered instead of collecting all first
  for (const directory of directories) {
    await walkAndProcess(directory, root, cutoff, dryRun, (entry) => {
      scannedFiles++;
      if (cutoff > 0 && entry.mtimeMs < cutoff) {
        if (!dryRun) {
          scheduleRemoval(entry, 'age');
        } else {
          countRemoval(entry, 'age');
        }
      } else {
        remaining.push(entry);
      }
    });
  }

  // Size-based cleanup on remaining
  if (config.maxTotalBytes > 0) {
    let totalBytes = remaining.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes > config.maxTotalBytes) {
      remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
      let i = 0;
      while (i < remaining.length && totalBytes > config.maxTotalBytes) {
        const entry = remaining[i]!;
        totalBytes -= entry.size;
        if (!dryRun) {
          scheduleRemoval(entry, 'size');
        } else {
          countRemoval(entry, 'size');
        }
        i++;
      }
      remaining.splice(0, i);
    }
  }

  if (!dryRun) {
    await Promise.all(pendingRemovals);
    // A vetoed/failed removal means the file survived: put it back so the
    // remaining counts (and the size accounting) describe what is actually on disk.
    if (failedRemovals.length > 0) {
      remaining.push(...failedRemovals);
    }
    await Promise.all(directories.map((dir) => pruneEmptyDirectories(dir)));
  }

  return {
    success: true,
    scannedFiles,
    removedFiles,
    removedBytes,
    removedByAge,
    removedBySize,
    failedRemovals: failedRemovals.length,
    remainingFiles: remaining.length,
    remainingBytes: remaining.reduce((sum, entry) => sum + entry.size, 0),
    dryRun,
    directories,
    ...(categories.length > 0 ? { categories } : {}),
    ...(excludeCategories.length > 0 ? { excludeCategories } : {}),
    removedSample,
    config,
  };
}

// Idempotency guard for the sweep timer: the scheduler is wired both from the
// server lifecycle (MCPServer.start) and from the CLI entry (index.ts); both
// must share ONE unref'd interval instead of stacking timers. Reset on stop so
// a restarted server re-arms.
let activeSchedulerStop: (() => void) | null | undefined;

export function startArtifactRetentionScheduler(): (() => void) | null {
  const config = getArtifactRetentionConfig();
  if (!config.enabled || config.cleanupIntervalMinutes <= 0) {
    return null;
  }

  if (activeSchedulerStop !== undefined) {
    return activeSchedulerStop;
  }

  const handle = setInterval(
    () => {
      /* v8 ignore next */
      void cleanupArtifacts()
        .then((result) => {
          if (result.removedFiles > 0) {
            logger.info(
              `[artifacts] retention cleanup removed ${result.removedFiles} files (${result.removedBytes} bytes)`,
            );
          }
        })
        .catch((error) => {
          logger.warn('[artifacts] retention cleanup failed', error);
        });
    },
    config.cleanupIntervalMinutes * 60 * 1000,
  );

  handle.unref();
  const stop = () => {
    if (activeSchedulerStop !== stop) {
      return;
    }
    clearInterval(handle);
    activeSchedulerStop = undefined;
  };
  activeSchedulerStop = stop;
  return stop;
}

/**
 * Caller-supplied directories are deletion roots, so they are constrained to
 * the same roots tool output may be written to (project root + system temp).
 * Managed defaults come from config and are intentionally not subjected to this
 * check: users may legitimately configure screenshot/debugger dirs elsewhere.
 *
 * Also drops duplicates and nested entries — walking a root and its
 * subdirectory would scan every file in the subtree twice.
 */
function resolveCallerDirectories(input: string[]): string[] {
  const safeRoots = getSafeOutputRoots().map((root) => resolve(root));
  const resolved = input.map((dir) => resolve(dir));

  for (const dir of resolved) {
    if (!safeRoots.some((root) => isStrictlyInside(root, dir))) {
      throw new Error(
        `Refusing to clean directory outside the approved roots (project/temp): ${dir}`,
      );
    }
  }

  const kept: string[] = [];
  for (const dir of [...new Set(resolved)].toSorted((a, b) => a.length - b.length)) {
    if (!kept.some((parent) => isStrictlyInside(parent, dir))) {
      kept.push(dir);
    }
  }
  return kept;
}

/** True when `target` is inside `base` (the root itself does not count). */
function isStrictlyInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function getManagedArtifactDirectories(options?: {
  categories?: ArtifactCategory[];
  excludeCategories?: ArtifactCategory[];
}): string[] {
  const hasCategoryFilter =
    (options?.categories?.length ?? 0) > 0 || (options?.excludeCategories?.length ?? 0) > 0;
  if (hasCategoryFilter) {
    const selected =
      options?.categories && options.categories.length > 0
        ? options.categories
        : [...MANAGED_ARTIFACT_CATEGORIES];
    const excluded = new Set(options?.excludeCategories ?? []);
    return selected
      .filter((category) => !excluded.has(category))
      .map((category) => getArtifactDir(category));
  }

  const projectRoot = getProjectRoot();
  const cwdDebuggerSessionsDir = resolve(process.cwd(), 'debugger-sessions');
  const projectDebuggerSessionsDir = resolve(projectRoot, 'debugger-sessions');
  // Only the artifacts ROOT is listed: walkAndProcess recurses, so adding
  // every category subdirectory too would scan and remove each artifact file
  // twice (inflated counters, wrong size trimming).
  const directories = new Set<string>([
    getArtifactsRoot(),
    getConfig().paths.screenshotDir,
    getDebuggerSessionsDir(),
    cwdDebuggerSessionsDir,
    projectDebuggerSessionsDir,
  ]);

  return [...directories];
}

function normalizeCategories(categories: ArtifactCategory[] | undefined): ArtifactCategory[] {
  if (!categories || categories.length === 0) return [];
  const allowed = new Set(MANAGED_ARTIFACT_CATEGORIES);
  const normalized: ArtifactCategory[] = [];
  for (const category of categories) {
    if (allowed.has(category) && !normalized.includes(category)) {
      normalized.push(category);
    }
  }
  return normalized;
}

async function walkAndProcess(
  directory: string,
  root: string,
  cutoff: number,
  dryRun: boolean,
  onFile: (entry: ArtifactFileEntry) => void,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkAndProcess(entryPath, root, cutoff, dryRun, onFile);
    } else if (entry.isFile()) {
      let info;
      try {
        info = await stat(entryPath);
      } catch {
        continue;
      }
      onFile({
        path: entryPath,
        relativePath: relativePathFromRoot(root, entryPath),
        size: info.size,
        mtimeMs: info.mtimeMs,
      });
    }
  }
}

async function removeFileIfUnchanged(
  path: string,
  mtimeMs: number,
  size: number,
): Promise<boolean> {
  try {
    const current = await stat(path);
    // Post-check: a concurrent writer that touched the file after the scan
    // must not be deleted. Compare mtime AND size so a write that preserved
    // the mtime tick is still vetoed.
    if (current.mtimeMs !== mtimeMs || current.size !== size) {
      return false;
    }
    await rm(path, { force: true });
    return true;
  } catch {
    // Already gone or unreadable — best effort.
    return false;
  }
}

async function pruneEmptyDirectories(directory: string, keepRoot = true): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => pruneEmptyDirectories(join(directory, entry.name), false)),
  );

  if (keepRoot) {
    // Managed root directories are the mkdir targets of resolveArtifactPath —
    // deleting them would race concurrent writers into ENOENT.
    return;
  }

  try {
    const after = await readdir(directory);
    if (after.length === 0) {
      // Plain rmdir: refuses to remove a directory that gained a file after
      // the emptiness re-check (rm recursive would destroy that file).
      await rmdir(directory);
    }
  } catch {
    // Non-critical cleanup — directory may already be gone or non-empty.
  }
}

function relativePathFromRoot(root: string, path: string): string {
  return path.startsWith(root)
    ? path
        .slice(root.length)
        .replace(/^[\\/]/, '')
        .replace(/\\/g, '/')
    : path.replace(/\\/g, '/');
}
