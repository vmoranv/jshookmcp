import { randomUUID } from 'node:crypto';
import { mkdir, lstat, open, realpath, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path';

export interface ResolveSafeOutputPathOptions {
  allowedRoots: string[];
  allowedRootsDescription: string;
}

function normalizeAbsolutePath(inputPath: string): string {
  return normalize(resolve(inputPath));
}

function isPathInsideOrEqual(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel === '' || (!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== '..');
}

export function resolveContainedPath(rootPath: string, childPath: string, label = 'path'): string {
  const normalizedRoot = normalizeAbsolutePath(rootPath);
  const childSegments = childPath.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (childSegments.includes('..')) {
    throw new Error(`${label} must not contain parent-directory segments`);
  }
  const candidatePath = normalizeAbsolutePath(resolve(normalizedRoot, childPath));
  if (!isPathInsideOrEqual(normalizedRoot, candidatePath)) {
    throw new Error(`${label} must stay within ${normalizedRoot}`);
  }

  return candidatePath;
}

export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  return isPathInsideOrEqual(normalizeAbsolutePath(rootPath), normalizeAbsolutePath(candidatePath));
}

export async function resolveSafeOutputPath(
  requestedPath: string,
  options: ResolveSafeOutputPathOptions,
): Promise<string> {
  const trimmedPath = requestedPath.trim();
  if (!trimmedPath) {
    throw new Error('outputPath must be a non-empty string');
  }

  const candidatePath = normalizeAbsolutePath(trimmedPath);
  const normalizedRoots = options.allowedRoots
    .map((rootPath) => rootPath.trim())
    .filter((rootPath) => rootPath.length > 0)
    .map((rootPath) => normalizeAbsolutePath(rootPath));

  if (
    normalizedRoots.length === 0 ||
    !normalizedRoots.some((rootPath) => isPathInsideOrEqual(rootPath, candidatePath))
  ) {
    throw new Error(`outputPath must be within the ${options.allowedRootsDescription}.`);
  }

  // Symlink-aware containment: the string-level check above can be bypassed
  // by a symlink inside a root that points outside it. Resolve the real path
  // of the deepest existing ancestor of the candidate and require it to stay
  // inside one of the (existing) roots' real paths. Roots that do not exist
  // yet cannot host a symlink, so the string check already suffices for them.
  const realCandidate = await resolveExistingAncestorRealPath(candidatePath);
  let checkedExistingRoot = false;
  for (const rootPath of normalizedRoots) {
    const realRoot = await realpathIfExists(rootPath);
    if (!realRoot) {
      continue;
    }
    checkedExistingRoot = true;
    if (isPathInsideOrEqual(realRoot, realCandidate)) {
      return candidatePath;
    }
  }
  if (checkedExistingRoot) {
    throw new Error(`outputPath must be within the ${options.allowedRootsDescription}.`);
  }

  return candidatePath;
}

/**
 * Guard a destructive operation (e.g. `rm -rf`).
 *
 * `resolveSafeOutputPath` accepts a path that is *equal* to an allowed root,
 * which is correct for writes but catastrophic for recursive deletion: it
 * would remove the whole project or system temp root. This rejects any target
 * that is equal to, or an ancestor of, an allowed root; only strict
 * descendants are deletable.
 */
export async function assertSafeRemovalTarget(
  targetPath: string,
  allowedRoots: string[],
): Promise<void> {
  const normalizedTarget = normalizeAbsolutePath(targetPath);
  // Only resolve the real path when the target itself exists; a not-yet-created
  // child must not inherit its parent root's real path or every delete beneath
  // the root would be rejected.
  const realTarget = await realpathIfExists(normalizedTarget);
  for (const rootPath of allowedRoots) {
    const normalizedRoot = normalizeAbsolutePath(rootPath);
    const realRoot = (await realpathIfExists(normalizedRoot)) ?? normalizedRoot;
    const targets = realTarget ? [normalizedTarget, realTarget] : [normalizedTarget];
    for (const target of targets) {
      // `root` inside (or equal to) `target` means the target is the root
      // itself or one of its ancestors.
      if (isPathInsideOrEqual(target, normalizedRoot) || isPathInsideOrEqual(target, realRoot)) {
        throw new Error('Refusing to remove an allowed output root or one of its ancestors.');
      }
    }
  }
}

/** Resolve a directory that is about to be recursively removed. */
export async function resolveSafeDeletableDir(
  requestedPath: string,
  options: ResolveSafeOutputPathOptions,
): Promise<string> {
  const resolved = await resolveSafeOutputPath(requestedPath, options);
  await assertSafeRemovalTarget(resolved, options.allowedRoots);
  return resolved;
}

/**
 * Resolve a caller-supplied path against the allowed roots, then write it.
 * Covers both text (string) and binary (Uint8Array) payloads. Parent
 * directories are created only after containment has been verified.
 */
export async function writeOutputFile(
  requestedPath: string,
  content: string | Uint8Array,
  options: ResolveSafeOutputPathOptions,
): Promise<string> {
  const absolutePath = await resolveSafeOutputPath(requestedPath, options);
  if (typeof content === 'string') {
    await writeTextFileAtomically(absolutePath, content, { allowedRoots: options.allowedRoots });
  } else {
    await writeBinaryFileAtomically(absolutePath, content, { allowedRoots: options.allowedRoots });
  }
  return absolutePath;
}

function isReplaceTargetError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EEXIST' || code === 'EPERM' || code === 'EACCES';
}

async function realpathIfExists(inputPath: string): Promise<string | null> {
  try {
    return normalizeAbsolutePath(await realpath(inputPath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function resolveExistingAncestorRealPath(inputPath: string): Promise<string> {
  let currentPath = normalizeAbsolutePath(inputPath);

  while (true) {
    const existingPath = await realpathIfExists(currentPath);
    if (existingPath) {
      return existingPath;
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`Unable to resolve an existing parent directory for ${inputPath}`);
    }
    currentPath = parentPath;
  }
}

async function closeHandle(handle: FileHandle | null): Promise<void> {
  if (!handle) {
    return;
  }

  try {
    await handle.close();
  } catch {
    // Best effort cleanup.
  }
}

export async function writeTextFileAtomically(
  absolutePath: string,
  content: string,
  options?: { rejectSymbolicLink?: boolean; allowedRoots?: string[] },
): Promise<void> {
  await writeFileAtomically(absolutePath, content, options);
}

export async function writeBinaryFileAtomically(
  absolutePath: string,
  content: Uint8Array,
  options?: { rejectSymbolicLink?: boolean; allowedRoots?: string[] },
): Promise<void> {
  await writeFileAtomically(absolutePath, content, options);
}

async function writeFileAtomically(
  absolutePath: string,
  content: string | Uint8Array,
  options?: { rejectSymbolicLink?: boolean; allowedRoots?: string[] },
): Promise<void> {
  const parentDir = dirname(absolutePath);

  // Containment check runs BEFORE mkdir: creating directories is a write
  // side-effect, so a parent that escapes the allowed roots must be refused
  // before anything is created outside them.
  if (options?.allowedRoots?.length) {
    const normalizedAllowedRoots = await Promise.all(
      options.allowedRoots.map(async (rootPath) => {
        const existingRoot = await realpathIfExists(rootPath);
        return existingRoot ?? normalizeAbsolutePath(rootPath);
      }),
    );
    const parentRealPath = await resolveExistingAncestorRealPath(parentDir);
    if (!normalizedAllowedRoots.some((rootPath) => isPathInsideOrEqual(rootPath, parentRealPath))) {
      throw new Error('outputPath parent directory escapes the allowed roots.');
    }
  }

  await mkdir(parentDir, { recursive: true });

  // The path's final component must be a real file name — "." or ".."
  // basenames would resolve the temp path / rename target to a directory
  // reference and could wipe or misplace data.
  const fileBaseName = basename(absolutePath);
  if (!fileBaseName || fileBaseName === '.' || fileBaseName === '..') {
    throw new Error('outputPath must point to a file name, not a directory reference.');
  }

  if (options?.rejectSymbolicLink !== false) {
    try {
      const existing = await lstat(absolutePath);
      if (existing.isSymbolicLink()) {
        throw new Error('outputPath must not be a symbolic link.');
      }
      if (existing.isDirectory()) {
        throw new Error('outputPath must be a file path, not a directory.');
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (
        code !== 'ENOENT' &&
        !(error instanceof Error && error.message.includes('symbolic link'))
      ) {
        throw error;
      }
      if (error instanceof Error && error.message.includes('symbolic link')) {
        throw error;
      }
    }
  }

  const tempPath = resolve(
    parentDir,
    `.${fileBaseName}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  let handle: FileHandle | null = null;
  try {
    handle = await open(tempPath, 'wx');
    if (typeof content === 'string') {
      await handle.writeFile(content, 'utf8');
    } else {
      await handle.writeFile(content);
    }
    await handle.sync();
    await closeHandle(handle);
    handle = null;

    try {
      await rename(tempPath, absolutePath);
      return;
    } catch (error) {
      if (!isReplaceTargetError(error)) {
        throw error;
      }
    }

    // Some platforms (Windows) refuse to rename over an existing target.
    // Clear the target's read-only bit instead of removing it: deleting
    // first opens a window in which another process can create a fresh file
    // that the rename would then silently overwrite. The chmod goes through
    // the target's own handle — a path-based chmod would follow a swapped
    // symlink — and only when the handle reports the same inode the lstat
    // saw, so a file replaced in between is never touched.
    const existingTarget = await lstat(absolutePath).catch(() => null);
    if (existingTarget && (existingTarget.isDirectory() || existingTarget.isSymbolicLink())) {
      throw new Error('outputPath must be a file path, not a directory or symbolic link.');
    }
    if (existingTarget?.isFile()) {
      const targetHandle = await open(absolutePath, 'r').catch(() => null);
      if (targetHandle) {
        try {
          const handleStat = await targetHandle.stat();
          if (handleStat.ino !== existingTarget.ino) {
            throw new Error('outputPath target changed while writing.');
          }
          await targetHandle.chmod(0o666);
        } finally {
          await closeHandle(targetHandle);
        }
      }
    }
    await rename(tempPath, absolutePath);
  } catch (error) {
    await closeHandle(handle);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
