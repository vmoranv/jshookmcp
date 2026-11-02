/**
 * Shadow-git task snapshots for scan artifacts.
 *
 * Implements CyberStrike-style snapshot/rollback over the scan output
 * directories (artifacts/, HAR captures, screenshots/, debugger-sessions/):
 *
 * - An INDEPENDENT git object store (GIT_DIR) holds snapshots; it never lives
 *   inside the target directory, so the user's project `.git` is never touched
 *   and no git commit is ever made.
 * - `snapshot()` stages the whole work tree (`add -A --force`) and records the
 *   resulting tree hash via `write-tree`.
 * - `restore()` reverts the work tree to a recorded tree (`read-tree` +
 *   `checkout-index -a -f`), deleting files that exist now but did not exist in
 *   the snapshot (full revert semantics).
 * - `gc()` drops expired snapshot records, removes their protection refs and
 *   lets `git gc` prune the now-unreachable objects.
 *
 * Snapshot identity lives in a JSON metadata file inside the GIT_DIR
 * (`{ version, snapshots: [{ id, treeHash, label, timestamp }] }`). Each
 * snapshot additionally holds a protection ref
 * (`refs/artifact-snapshots/<id>` -> tree) so `git gc` — automatic or explicit
 * — can never prune the objects of a live snapshot; refs alone cannot carry
 * labels/timestamps, which is why the JSON file is the source of truth.
 *
 * Every git invocation goes through `execFile` with an argument ARRAY (no
 * shell), and GIT_DIR/GIT_WORK_TREE are passed as environment variables, so
 * paths can never be re-interpreted by a shell.
 */

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, normalize, resolve } from 'node:path';
import { promisify } from 'node:util';
import { isPathWithinRoot, writeTextFileAtomically } from '@utils/safeOutput';

const execFileAsync = promisify(execFile);

/** Normalized error for every failure mode of the snapshot manager. */
export type SnapshotErrorCode =
  | 'GIT_UNAVAILABLE'
  | 'GIT_INIT_FAILED'
  | 'GIT_COMMAND_FAILED'
  | 'SNAPSHOT_NOT_FOUND'
  | 'TREE_MISSING'
  | 'METADATA_CORRUPT'
  | 'INVALID_ARGUMENT';

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode;
  readonly gitStderr?: string;
  readonly gitExitCode?: number;

  constructor(
    code: SnapshotErrorCode,
    message: string,
    options?: { stderr?: string; exitCode?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SnapshotError';
    this.code = code;
    if (options?.stderr !== undefined) {
      this.gitStderr = options.stderr;
    }
    if (options?.exitCode !== undefined) {
      this.gitExitCode = options.exitCode;
    }
  }
}

export interface SnapshotRecord {
  /** Stable snapshot id (`snap-<base36 epoch ms>-<8 hex>`), refname-safe. */
  id: string;
  /** Git tree hash capturing the full work-tree state. */
  treeHash: string;
  /** Optional human-readable label. */
  label?: string;
  /** Creation time (ISO-8601 UTC). */
  timestamp: string;
}

export interface SnapshotRestoreResult {
  snapshotId: string;
  treeHash: string;
  /** Number of files written back from the snapshot tree. */
  restoredFiles: number;
  /** Number of files deleted because they did not exist in the snapshot. */
  deletedFiles: number;
  /** First few deleted paths (bounded sample for large reverts). */
  deletedSample: string[];
}

export interface SnapshotGcResult {
  /** Snapshots removed from the metadata index. */
  removedSnapshots: number;
  /** Snapshots still retained after the age cutoff. */
  remainingSnapshots: number;
  /** Whether `git gc` ran (skipped when nothing was removed or it failed). */
  pruned: boolean;
}

export interface ArtifactSnapshotManagerOptions {
  /** GIT_DIR — the isolated shadow-git object store. Must not be a path
   * inside the work tree (git would otherwise index the store itself). */
  storeDir: string;
  /** GIT_WORK_TREE — the directory being snapshotted/restored. */
  workTree: string;
}

/** Structural contract satisfied by ArtifactSnapshotManager (allows handler-level fakes). */
export interface SnapshotManager {
  ensureRepo(): Promise<void>;
  snapshot(label?: string): Promise<SnapshotRecord>;
  list(): Promise<SnapshotRecord[]>;
  restore(snapshotId: string): Promise<SnapshotRestoreResult>;
  gc(maxAgeDays: number): Promise<SnapshotGcResult>;
}

const METADATA_FILE = 'snapshots.json';
const METADATA_VERSION = 1;
const REF_NAMESPACE = 'refs/artifact-snapshots';
/** Sample cap so restore responses stay bounded even for huge reverts. */
const DELETED_SAMPLE_LIMIT = 10;
/** Objects newer than this are never pruned by gc (concurrency safety). */
const GC_MIN_AGE = '2.hours.ago';

interface SnapshotMetadataFile {
  version: number;
  snapshots: SnapshotRecord[];
}

function isSnapshotRecord(value: unknown): value is SnapshotRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.treeHash === 'string' &&
    record.treeHash.length > 0 &&
    typeof record.timestamp === 'string'
  );
}

/**
 * Deterministic store location for a target directory, living OUTSIDE the
 * target: `<baseDir>/<basename>-<sha256(target)-12>`. Falls back to
 * `fallbackBaseDir` when the primary base would end up inside the target
 * (e.g. the target is the project root itself).
 */
export function deriveSnapshotStoreDir(
  targetDir: string,
  baseDir: string,
  fallbackBaseDir: string,
): string {
  const resolvedTarget = normalize(resolve(targetDir));
  const primaryBase = normalize(resolve(baseDir));
  const safeBase = isPathWithinRoot(resolvedTarget, primaryBase)
    ? normalize(resolve(fallbackBaseDir))
    : primaryBase;

  const digest = createHash('sha256').update(resolvedTarget).digest('hex').slice(0, 12);
  const rawBase = basename(resolvedTarget)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const key = `${rawBase.length > 0 ? rawBase : 'root'}-${digest}`;
  return resolve(safeBase, key);
}

/**
 * Snapshot/rollback manager over an isolated git object store.
 *
 * The store is lazily initialized as a BARE repository (no work tree of its
 * own); the snapshotted directory is supplied per-invocation through the
 * GIT_WORK_TREE environment variable.
 */
export class ArtifactSnapshotManager implements SnapshotManager {
  private readonly storeDir: string;
  private readonly workTree: string;
  /** Serializes mutating operations per manager (metadata read-modify-write). */
  private queue: Promise<unknown> = Promise.resolve();
  private repoReady: Promise<void> | null = null;

  constructor(options: ArtifactSnapshotManagerOptions) {
    if (!options.storeDir || typeof options.storeDir !== 'string') {
      throw new SnapshotError('INVALID_ARGUMENT', 'storeDir must be a non-empty string');
    }
    if (!options.workTree || typeof options.workTree !== 'string') {
      throw new SnapshotError('INVALID_ARGUMENT', 'workTree must be a non-empty string');
    }
    this.storeDir = normalize(resolve(options.storeDir));
    this.workTree = normalize(resolve(options.workTree));
    if (isPathWithinRoot(this.workTree, this.storeDir)) {
      throw new SnapshotError(
        'INVALID_ARGUMENT',
        `storeDir "${this.storeDir}" must live outside the work tree "${this.workTree}" ` +
          '(git would otherwise index the store during add -A)',
      );
    }
  }

  /** Lazily initialize the bare object store (idempotent). */
  async ensureRepo(): Promise<void> {
    this.repoReady ??= this.initializeRepo();
    try {
      await this.repoReady;
    } catch (error) {
      // Allow a retry after a failed init (e.g. transient FS error).
      this.repoReady = null;
      throw error;
    }
  }

  /**
   * Capture the current work-tree state (`add -A --force` + `write-tree`).
   * Returns the created snapshot record (id, treeHash, timestamp, label).
   */
  async snapshot(label?: string): Promise<SnapshotRecord> {
    return this.enqueue(async () => {
      await this.ensureRepo();
      await mkdir(this.workTree, { recursive: true });

      await this.git(['add', '-A', '--force']);
      const treeHash = (await this.git(['write-tree'])).trim();
      if (!/^[0-9a-f]{40}$/i.test(treeHash)) {
        throw new SnapshotError('GIT_COMMAND_FAILED', `write-tree returned "${treeHash}"`);
      }

      const record: SnapshotRecord = {
        id: `snap-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
        treeHash,
        timestamp: new Date().toISOString(),
        ...(label !== undefined && label !== '' ? { label } : {}),
      };

      await this.git(['update-ref', `${REF_NAMESPACE}/${record.id}`, treeHash]);
      const metadata = await this.readMetadata();
      metadata.snapshots.push(record);
      await this.writeMetadata(metadata);

      return record;
    });
  }

  /** List recorded snapshots, newest first. */
  async list(): Promise<SnapshotRecord[]> {
    await this.ensureRepo();
    const metadata = await this.readMetadata();
    return [...metadata.snapshots].toSorted((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Revert the work tree to a recorded snapshot:
   * files modified since the snapshot are overwritten, files created after it
   * are DELETED, files deleted after it are restored.
   */
  async restore(snapshotId: string): Promise<SnapshotRestoreResult> {
    if (!snapshotId || typeof snapshotId !== 'string') {
      throw new SnapshotError('INVALID_ARGUMENT', 'snapshotId must be a non-empty string');
    }
    return this.enqueue(async () => {
      await this.ensureRepo();

      const metadata = await this.readMetadata();
      const record = metadata.snapshots.find((entry) => entry.id === snapshotId);
      if (!record) {
        throw new SnapshotError('SNAPSHOT_NOT_FOUND', `Unknown snapshot id "${snapshotId}"`);
      }

      // Fail fast (before touching the work tree) when the tree objects were
      // already pruned by an out-of-band gc.
      await this.git(['cat-file', '-e', `${record.treeHash}^{tree}`]);

      // Replace the index with the snapshot tree.
      await this.git(['read-tree', record.treeHash]);

      // Anything present on disk but absent from the snapshot tree must go
      // (revert semantics). `ls-files --others` after read-tree lists exactly
      // those paths, relative to the work-tree root.
      const othersRaw = await this.git(['ls-files', '--others', '--full-name', '-z']);
      const stalePaths = othersRaw
        .split('\0')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const deletedSample: string[] = [];
      for (const relativePath of stalePaths) {
        const absolutePath = resolve(this.workTree, relativePath);
        // Defense in depth: git printed the path, but never delete outside
        // the work tree.
        if (!isPathWithinRoot(this.workTree, absolutePath) || absolutePath === this.workTree) {
          continue;
        }
        await rm(absolutePath, { force: true, recursive: false }).catch(() => undefined);
        if (deletedSample.length < DELETED_SAMPLE_LIMIT) {
          deletedSample.push(relativePath);
        }
      }

      await this.git(['checkout-index', '-a', '-f']);
      const restoredRaw = await this.git(['ls-files', '--full-name']);
      const restoredFiles = restoredRaw
        .split('\n')
        .filter((entry) => entry.trim().length > 0).length;

      return {
        snapshotId: record.id,
        treeHash: record.treeHash,
        restoredFiles,
        deletedFiles: stalePaths.length,
        deletedSample,
      };
    });
  }

  /**
   * Remove snapshots older than `maxAgeDays`, drop their protection refs and
   * prune the now-unreachable objects. Objects newer than `GC_MIN_AGE` are
   * always spared so a concurrently-created snapshot can never lose its tree.
   */
  async gc(maxAgeDays: number): Promise<SnapshotGcResult> {
    if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
      throw new SnapshotError('INVALID_ARGUMENT', 'maxAgeDays must be a non-negative number');
    }
    return this.enqueue(async () => {
      await this.ensureRepo();

      const metadata = await this.readMetadata();
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      const kept = metadata.snapshots.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
      const expired = metadata.snapshots.filter((entry) => Date.parse(entry.timestamp) < cutoff);
      if (expired.length === 0) {
        return {
          removedSnapshots: 0,
          remainingSnapshots: metadata.snapshots.length,
          pruned: false,
        };
      }

      metadata.snapshots = kept;
      await this.writeMetadata(metadata);

      for (const entry of expired) {
        await this.git(['update-ref', '-d', `${REF_NAMESPACE}/${entry.id}`]).catch(() => undefined);
      }

      let pruned = false;
      try {
        await this.git(['gc', `--prune=${GC_MIN_AGE}`]);
        pruned = true;
      } catch {
        // Housekeeping only: the snapshot records are already consistent.
        pruned = false;
      }

      return {
        removedSnapshots: expired.length,
        remainingSnapshots: kept.length,
        pruned,
      };
    });
  }

  // ── internals ──

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async initializeRepo(): Promise<void> {
    try {
      await stat(resolve(this.storeDir, 'HEAD'));
      return; // Already a (bare) git dir.
    } catch {
      // Not initialized yet — fall through to `git init --bare`.
    }

    await mkdir(this.storeDir, { recursive: true });
    // NOTE: GIT_WORK_TREE must NOT be set for `init --bare` (git rejects the
    // combination), so init runs with a clean git env.
    try {
      await execFileAsync('git', ['init', '--quiet', '--bare', this.storeDir], {
        cwd: this.storeDir,
        env: gitCleanEnv(),
        windowsHide: true,
      });
    } catch (error) {
      throw toSnapshotError('GIT_INIT_FAILED', 'git init --bare failed', error);
    }

    // Byte-faithful snapshots: no EOL rewriting on either direction; and no
    // opportunistic auto-gc that could prune unprotected trees mid-flight.
    for (const [key, value] of [
      ['core.autocrlf', 'false'],
      ['core.safecrlf', 'false'],
      ['core.longpaths', 'true'],
      ['gc.auto', '0'],
    ] as const) {
      await this.git(['config', key, value]);
    }
  }

  /** Run git against GIT_DIR/GIT_WORK_TREE via execFile (no shell). */
  private async git(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', [...args], {
        cwd: this.workTree,
        env: gitWorkTreeEnv(this.storeDir, this.workTree),
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      throw toSnapshotError('GIT_COMMAND_FAILED', `git ${args[0]} failed`, error);
    }
  }

  private metadataPath(): string {
    return resolve(this.storeDir, METADATA_FILE);
  }

  private async readMetadata(): Promise<SnapshotMetadataFile> {
    try {
      const raw = await readFile(this.metadataPath(), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('metadata root is not an object');
      }
      const container = parsed as Record<string, unknown>;
      if (container.version !== METADATA_VERSION || !Array.isArray(container.snapshots)) {
        throw new Error('metadata shape mismatch');
      }
      const snapshots = container.snapshots.filter(isSnapshotRecord);
      return { version: METADATA_VERSION, snapshots };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') {
        return { version: METADATA_VERSION, snapshots: [] };
      }
      throw new SnapshotError('METADATA_CORRUPT', `Failed to read snapshot metadata`, {
        cause: error,
      });
    }
  }

  private async writeMetadata(metadata: SnapshotMetadataFile): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });
    await writeTextFileAtomically(this.metadataPath(), `${JSON.stringify(metadata, null, 2)}\n`);
  }
}

function gitCleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  return env;
}

function gitWorkTreeEnv(storeDir: string, workTree: string): NodeJS.ProcessEnv {
  const env = gitCleanEnv();
  env.GIT_DIR = storeDir;
  env.GIT_WORK_TREE = workTree;
  return env;
}

function toSnapshotError(code: SnapshotErrorCode, message: string, error: unknown): SnapshotError {
  if (error instanceof SnapshotError) {
    return error;
  }
  const err = error as (Error & { code?: string | number; stderr?: string }) | null;
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : undefined;
  const exitCode = typeof err?.code === 'number' ? err.code : undefined;
  const detail = stderr !== undefined && stderr.length > 0 ? `: ${stderr}` : '';
  return new SnapshotError(code, `${message}${detail}`, { stderr, exitCode, cause: error });
}
