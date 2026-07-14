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

  return candidatePath;
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
  await mkdir(parentDir, { recursive: true });

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
    `.${basename(absolutePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
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

    await rm(absolutePath, { force: true });
    await rename(tempPath, absolutePath);
  } catch (error) {
    await closeHandle(handle);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
