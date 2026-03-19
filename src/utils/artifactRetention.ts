import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getArtifactDir, getArtifactsRoot, type ArtifactCategory } from '@utils/artifacts';
import { getProjectRoot, resolveOutputDirectory } from '@utils/outputPaths';
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
  env: NodeJS.ProcessEnv = process.env
): ArtifactRetentionConfig {
  const retentionDays = Math.max(0, parseInt(env.MCP_ARTIFACT_RETENTION_DAYS ?? '0', 10) || 0);
  const maxTotalMb = Math.max(0, parseInt(env.MCP_ARTIFACT_MAX_TOTAL_MB ?? '0', 10) || 0);
  const cleanupIntervalMinutes = Math.max(
    0,
    parseInt(env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES ?? '0', 10) || 0
  );
  const cleanupOnStart = ['1', 'true'].includes(
    (env.MCP_ARTIFACT_CLEANUP_ON_START ?? '').toLowerCase()
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
  const entries = await collectArtifactFiles(directories);
  let remaining = [...entries];
  const removedSample: string[] = [];
  let removedFiles = 0;
  let removedBytes = 0;
  let removedByAge = 0;
  let removedBySize = 0;

  const cutoff = config.retentionDays > 0 ? now - config.retentionDays * DAY_MS : 0;
  if (cutoff > 0) {
    const agedOut = remaining
      .filter((entry) => entry.mtimeMs < cutoff)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    if (agedOut.length > 0) {
      const agedOutPaths = new Set(agedOut.map((entry) => entry.path));
      remaining = remaining.filter((entry) => !agedOutPaths.has(entry.path));
      removedFiles += agedOut.length;
      removedBytes += agedOut.reduce((sum, entry) => sum + entry.size, 0);
      removedByAge += agedOut.reduce((sum, entry) => sum + entry.size, 0);
      removedSample.push(
        ...agedOut.slice(0, 20 - removedSample.length).map((entry) => entry.relativePath)
      );
      if (!dryRun) {
        await Promise.all(agedOut.map((entry) => rm(entry.path, { force: true })));
      }
    }
  }

  if (config.maxTotalBytes > 0) {
    let totalBytes = remaining.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes > config.maxTotalBytes) {
      const sizeCandidates = [...remaining].sort((a, b) => a.mtimeMs - b.mtimeMs);
      const removedPaths = new Set<string>();
      for (const entry of sizeCandidates) {
        if (totalBytes <= config.maxTotalBytes) break;
        totalBytes -= entry.size;
        removedPaths.add(entry.path);
        removedFiles += 1;
        removedBytes += entry.size;
        removedBySize += entry.size;
        if (removedSample.length < 20) removedSample.push(entry.relativePath);
        if (!dryRun) {
          await rm(entry.path, { force: true });
        }
      }
      remaining = remaining.filter((entry) => !removedPaths.has(entry.path));
    }
  }

  if (!dryRun) {
    await Promise.all(directories.map((dir) => pruneEmptyDirectories(dir)));
  }

  return {
    success: true,
    scannedFiles: entries.length,
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
      void cleanupArtifacts()
        .then((result) => {
          if (result.removedFiles > 0) {
            logger.info(
              `[artifacts] retention cleanup removed ${result.removedFiles} files (${result.removedBytes} bytes)`
            );
          }
        })
        .catch((error) => {
          logger.warn('[artifacts] retention cleanup failed', error);
        });
    },
    config.cleanupIntervalMinutes * 60 * 1000
  );

  handle.unref();
  return () => clearInterval(handle);
}

function getManagedArtifactDirectories(): string[] {
  const projectRoot = getProjectRoot();
  const directories = new Set<string>([
    getArtifactsRoot(),
    resolveOutputDirectory(process.env.MCP_SCREENSHOT_DIR, 'screenshots'),
    resolve(projectRoot, 'debugger-sessions'),
    resolve(process.cwd(), 'debugger-sessions'),
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

async function collectArtifactFiles(directories: string[]): Promise<ArtifactFileEntry[]> {
  const root = getProjectRoot();
  const files: ArtifactFileEntry[] = [];

  for (const directory of directories) {
    await walk(directory, async (path) => {
      const info = await stat(path);
      if (!info.isFile()) return;
      files.push({
        path,
        relativePath: relativePathFromRoot(root, path),
        size: info.size,
        mtimeMs: info.mtimeMs,
      });
    });
  }

  return dedupeFiles(files);
}

async function walk(directory: string, onFile: (path: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, onFile);
    } else if (entry.isFile()) {
      await onFile(path);
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
      .map((entry) => pruneEmptyDirectories(join(directory, entry.name)))
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

function dedupeFiles(files: ArtifactFileEntry[]): ArtifactFileEntry[] {
  const byPath = new Map<string, ArtifactFileEntry>();
  for (const file of files) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

function relativePathFromRoot(root: string, path: string): string {
  return path.startsWith(root)
    ? path
        .slice(root.length)
        .replace(/^[\\/]/, '')
        .replace(/\\/g, '/')
    : path.replace(/\\/g, '/');
}
