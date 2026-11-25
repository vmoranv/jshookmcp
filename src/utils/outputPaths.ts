import { lstat, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import { projectRoot as configProjectRoot, getConfig, isNpxContext } from '@utils/config';
import { readEnvNullableString } from '@src/config/environment';

// Use config.ts's projectRoot as the single source of truth.
// Both files compute import.meta.url-based roots with different fallback
// depths (config: ../.. / outputPaths: .. in bundled prod), which diverge
// when tsdown flattens them into the same chunk. This caused screenshot
// and other path checks to fail isInside() silently.
const defaultProjectRoot = configProjectRoot;

/**
 * In npx / global-install contexts the package root is in a read-only
 * npm cache.  Redirect to the user's cwd so that relative-path validation
 * and output directories land in their project, not the install cache.
 */
function resolveProjectRoot(env?: NodeJS.ProcessEnv): string {
  const requestedRoot = readEnvNullableString('MCP_PROJECT_ROOT', { env, trim: true });
  if (requestedRoot) {
    return normalize(
      isUserAbsolutePath(requestedRoot)
        ? requestedRoot
        : resolve(defaultProjectRoot, requestedRoot),
    );
  }
  return isNpxContext() ? process.cwd() : defaultProjectRoot;
}

function isUserAbsolutePath(inputPath: string): boolean {
  return isAbsolute(inputPath) || /^[A-Za-z]:[\\/]/.test(inputPath) || inputPath.startsWith('\\\\');
}

function isInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return false;
  }
  return true;
}

async function realpathOrLexical(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch {
    // Not created yet (tests mock mkdir) — fall back to the lexical path.
    return normalize(targetPath);
  }
}

/**
 * Symlink-aware containment: a directory inside the project root may itself be
 * a symlink pointing elsewhere, so the deepest existing ancestor must be
 * resolved before trusting the lexical check.
 */
async function isDirInsideRealRoot(root: string, dir: string): Promise<boolean> {
  const [realRoot, realDir] = await Promise.all([realpathOrLexical(root), realpathOrLexical(dir)]);
  return isInside(realRoot, realDir);
}

/** True when the final path component already exists as a symlink (write would follow it). */
async function isExistingSymlink(targetPath: string): Promise<boolean> {
  try {
    return (await lstat(targetPath)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function isSafeScreenshotTarget(projectRoot: string, candidate: string): Promise<boolean> {
  return (
    isInside(projectRoot, candidate) &&
    !(await isExistingSymlink(candidate)) &&
    (await isDirInsideRealRoot(projectRoot, dirname(candidate)))
  );
}

function resolveWithinProject(inputPath: string, baseRoot = getProjectRoot()): string {
  const candidate = isUserAbsolutePath(inputPath)
    ? normalize(inputPath)
    : resolve(baseRoot, inputPath);
  return isInside(baseRoot, candidate)
    ? candidate
    : resolve(
        baseRoot,
        'screenshots',
        'external',
        normalize(inputPath).split(/[\\/]/).pop() || 'output.bin',
      );
}

function withDefaultExtension(filePath: string, extension: string): string {
  if (extname(filePath)) {
    return filePath;
  }
  return `${filePath}.${extension.replace(/^\./, '')}`;
}

export function getProjectRoot(): string {
  return resolveProjectRoot();
}

export function resolveRelativeProjectPath(inputPath: string): string {
  const projectRoot = getProjectRoot();
  const requested = inputPath.trim();

  if (!requested) {
    throw new Error('path must be a non-empty relative path within the project root');
  }
  if (isUserAbsolutePath(requested)) {
    throw new Error('path must be relative to the project root');
  }

  const resolvedPath = normalize(resolve(projectRoot, requested));
  if (!isInside(projectRoot, resolvedPath)) {
    throw new Error('path must stay within the project root');
  }

  return resolvedPath;
}

export function resolveOutputDirectory(
  inputDir: string | undefined,
  fallbackDir = 'screenshots',
): string {
  const projectRoot = getProjectRoot();
  const requested = inputDir?.trim();
  if (!requested) {
    return resolve(projectRoot, fallbackDir);
  }

  const resolved = resolveWithinProject(requested, projectRoot);
  if (isInside(projectRoot, resolved)) {
    return resolved;
  }
  /* v8 ignore next */
  return resolve(projectRoot, fallbackDir);
}

export function getDebuggerSessionsDir(): string {
  return getConfig().paths.debuggerSessionsDir;
}

export function getExtensionRegistryDir(): string {
  return getConfig().paths.extensionRegistryDir;
}

export function getCodeCacheDir(): string {
  return resolve(getConfig().cache.dir, 'code');
}

export function getTlsKeyLogDir(): string {
  return getConfig().paths.tlsKeyLogDir;
}

/**
 * Directory for TLS keylog files that are sealed (encrypted) immediately
 * after parsing. Deliberately separate from getTlsKeyLogDir(): the latter is
 * the historical SSLKEYLOGFILE target (still the default because BoringSSL/
 * Node's TLS stack itself writes there — this process cannot intercept that
 * write), while this one is where TLSKeyLogExtractor.sealKeyLog() writes the
 * post-parse encrypted envelope once the plaintext source has been wiped.
 */
export function getEphemeralKeylogDir(): string {
  return resolve(getTlsKeyLogDir(), 'sealed');
}

export function getSystemTempRoots(): string[] {
  const roots = new Set<string>();
  const candidates = [process.env.TEMP, process.env.TMP, tmpdir()];
  for (const candidate of candidates) {
    const requested = candidate?.trim();
    if (!requested) {
      continue;
    }

    roots.add(normalize(resolve(requested)));
  }

  return [...roots];
}

/** Roots that tool output paths are allowed to resolve into. */
export function getSafeOutputRoots(): string[] {
  return [getProjectRoot(), ...getSystemTempRoots()];
}

export async function resolveScreenshotOutputPath(options: {
  requestedPath?: string;
  type?: 'png' | 'jpeg';
  fallbackName?: string;
  fallbackDir?: string;
}): Promise<{ absolutePath: string; displayPath: string; pathRewritten: boolean }> {
  const projectRoot = getProjectRoot();
  const extension = options.type === 'jpeg' ? 'jpg' : 'png';
  const fallbackDir = options.fallbackDir || 'screenshots/manual';
  const fallbackName = options.fallbackName || 'page';
  const screenshotRoot = resolveOutputDirectory(getConfig().paths.screenshotDir, fallbackDir);
  const requested = options.requestedPath?.trim();

  let absolutePath: string;
  let pathRewritten = false;
  if (!requested) {
    absolutePath = resolve(screenshotRoot, `${fallbackName}-${Date.now()}.${extension}`);
    pathRewritten = true;
  } else {
    const requestedWithExt = withDefaultExtension(requested, extension);
    if (isUserAbsolutePath(requestedWithExt)) {
      // SECURITY: Do NOT honor user-provided absolute paths — rewrite to safe dir.
      // This prevents arbitrary file overwrite via the screenshot tool.
      absolutePath = resolve(screenshotRoot, basename(requestedWithExt));
      pathRewritten = true;
    } else {
      absolutePath = resolve(projectRoot, requestedWithExt);
      if (!isInside(projectRoot, absolutePath)) {
        absolutePath = resolve(screenshotRoot, basename(absolutePath));
        pathRewritten = true;
      }
    }
  }

  await mkdir(dirname(absolutePath), { recursive: true });

  // SECURITY: lexical isInside() cannot see symlinks. A crafted repo can make
  // `screenshots/` (or any ancestor, or the target file itself) a link to an
  // outside location, so re-validate the real path of the deepest existing
  // ancestor and rewrite if it escapes the project root.
  if (!(await isSafeScreenshotTarget(projectRoot, absolutePath))) {
    const safeName = basename(absolutePath);
    const inProjectCandidate = resolve(screenshotRoot, safeName);
    await mkdir(dirname(inProjectCandidate), { recursive: true });
    if (await isSafeScreenshotTarget(projectRoot, inProjectCandidate)) {
      absolutePath = inProjectCandidate;
    } else {
      // Even the configured screenshot root is symlinked outside the repo: land
      // in the OS temp dir (an allowed output root) instead of following it.
      absolutePath = resolve(tmpdir(), 'jshook-screenshots', safeName);
      await mkdir(dirname(absolutePath), { recursive: true });
    }
    pathRewritten = true;
  }

  const displayPath = isInside(projectRoot, absolutePath)
    ? relative(projectRoot, absolutePath).replace(/\\/g, '/')
    : absolutePath.replace(/\\/g, '/');
  return { absolutePath, displayPath, pathRewritten };
}
