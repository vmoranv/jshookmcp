import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getArtifactDir, getArtifactsRoot, type ArtifactCategory } from '@utils/artifacts';
import { getConfig } from '@utils/config';
import { getDebuggerSessionsDir, getProjectRoot } from '@utils/outputPaths';
import { logger } from '@utils/logger';

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
  remainingFiles: number;
  remainingBytes: number;
  dryRun: boolean;
  directories: string[];
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

export function getArtifactRetentionConfig(
  env: NodeJS.ProcessEnv = process.env,
): ArtifactRetentionConfig {
  const retentionDays = Math.max(0, parseInt(env.MCP_ARTIFACT_RETENTION_DAYS ?? '0', 10) || 0);
  const maxTotalMb = Math.max(0, parseInt(env.MCP_ARTIFACT_MAX_TOTAL_MB ?? '0', 10) || 0);
  const cleanupIntervalMinutes = Math.max(
    0,
    parseInt(env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES ?? '0', 10) || 0,
  );
  const cleanupOnStart = ['1', 'true'].includes(
    (env.MCP_ARTIFACT_CLEANUP_ON_START ?? '').toLowerCase(),
  );
  return {
    enabled: retentionDays > 0 || maxTotalMb > 0,
    retentionDays,
    maxTotalBytes: maxTotalMb * 1024 * 1024,
    cleanupOnStart,
    cleanupIntervalMinutes,
  };
}

export async function cleanupArtifacts(options?: {
  retentionDays?: number;
  maxTotalBytes?: number;
  dryRun?: boolean;
  now?: number;
  directories?: string[];
}): Promise<ArtifactCleanupResult> {
  const envConfig = getArtifactRetentionConfig();
  const config: ArtifactRetentionConfig = {
    ...envConfig,
    retentionDays: options?.retentionDays ?? envConfig.retentionDays,
    maxTotalBytes: options?.maxTotalBytes ?? envConfig.maxTotalBytes,
  };

  const now = options?.now ?? Date.now();
  const dryRun = options?.dryRun ?? false;
  const directories = options?.directories ?? getManagedArtifactDirectories();

  const cutoff = config.retentionDays > 0 ? now - config.retentionDays * DAY_MS : 0;
  let scannedFiles = 0;
  let removedFiles = 0;
  let removedBytes = 0;
  let removedByAge = 0;
  let removedBySize = 0;
  const remaining: ArtifactFileEntry[] = [];
  const removedSample: string[] = [];
  const root = getProjectRoot();
  const pendingRemovals: Promise<void>[] = [];

  function scheduleRemoval(path: string): void {
    pendingRemovals.push(
      rm(path, { force: true })
        .then(() => undefined)
        .catch(() => undefined),
    );
  }

  // Stream-based: process each file as it's discovered instead of collecting all first
  for (const directory of directories) {
    await walkAndProcess(directory, root, cutoff, dryRun, (entry) => {
      scannedFiles++;
      if (cutoff > 0 && entry.mtimeMs < cutoff) {
        removedFiles++;
        removedBytes += entry.size;
        removedByAge += entry.size;
        if (removedSample.length < 20) removedSample.push(entry.relativePath);
        if (!dryRun) scheduleRemoval(entry.path);
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
        removedFiles++;
        removedBytes += entry.size;
        removedBySize += entry.size;
        if (removedSample.length < 20) removedSample.push(entry.relativePath);
        if (!dryRun) scheduleRemoval(entry.path);
        i++;
      }
      remaining.splice(0, i);
    }
  }

  if (!dryRun) {
    await Promise.all(pendingRemovals);
    await Promise.all(directories.map((dir) => pruneEmptyDirectories(dir)));
  }

  return {
    success: true,
    scannedFiles,
    removedFiles,
    removedBytes,
    removedByAge,
    removedBySize,
    remainingFiles: remaining.length,
    remainingBytes: remaining.reduce((sum, entry) => sum + entry.size, 0),
    dryRun,
    directories,
    removedSample,
    config,
  };
}

export function startArtifactRetentionScheduler(): (() => void) | null {
  const config = getArtifactRetentionConfig();
  if (!config.enabled || config.cleanupIntervalMinutes <= 0) {
    return null;
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
  return () => clearInterval(handle);
}

function getManagedArtifactDirectories(): string[] {
  const projectRoot = getProjectRoot();
  const cwdDebuggerSessionsDir = resolve(process.cwd(), 'debugger-sessions');
  const projectDebuggerSessionsDir = resolve(projectRoot, 'debugger-sessions');
  const directories = new Set<string>([
    getArtifactsRoot(),
    getConfig().paths.screenshotDir,
    getDebuggerSessionsDir(),
    cwdDebuggerSessionsDir,
    projectDebuggerSessionsDir,
  ]);

  const categories: ArtifactCategory[] = [
    'wasm',
    'traces',
    'profiles',
    'dumps',
    'reports',
    'har',
    'sessions',
    'tmp',
  ];
  for (const category of categories) {
    directories.add(getArtifactDir(category));
  }

  return [...directories];
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

async function pruneEmptyDirectories(directory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => pruneEmptyDirectories(join(directory, entry.name))),
  );

  try {
    const after = await readdir(directory);
    if (after.length === 0) {
      await rm(directory, { recursive: true, force: true });
    }
  } catch {
    // Non-critical cleanup — directory may already be gone
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
