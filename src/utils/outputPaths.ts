import { mkdir } from 'node:fs/promises';
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
import { fileURLToPath } from 'node:url';
import { getConfig } from '@utils/config';

// In a flattened tsdown bundle, import.meta.url points to dist/index.mjs.
// Therefore, the project root is just one directory up.
// When running in Vitest, this file stays deeply nested in src/utils/outputPaths.ts.
const currentFileUrl = fileURLToPath(import.meta.url);
const defaultProjectRoot =
  currentFileUrl.includes('/src/utils/') || currentFileUrl.includes('\\src\\utils\\')
    ? fileURLToPath(new URL('../..', import.meta.url))
    : fileURLToPath(new URL('..', import.meta.url));

function resolveProjectRoot(env: NodeJS.ProcessEnv = process.env): string {
  const requestedRoot = env.MCP_PROJECT_ROOT?.trim();
  if (!requestedRoot) {
    return defaultProjectRoot;
  }

  return normalize(
    isAbsolute(requestedRoot) ? requestedRoot : resolve(defaultProjectRoot, requestedRoot),
  );
}

function isInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return false;
  }
  return true;
}

function resolveWithinProject(inputPath: string, baseRoot = getProjectRoot()): string {
  const candidate = isAbsolute(inputPath) ? normalize(inputPath) : resolve(baseRoot, inputPath);
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
    if (isAbsolute(requestedWithExt)) {
      // SECURITY: Do NOT honor user-provided absolute paths — rewrite to safe dir.
      // This prevents arbitrary file overwrite via the screenshot tool.
      absolutePath = resolve(screenshotRoot, basename(requestedWithExt));
      pathRewritten = true;
    } else {
      absolutePath = resolve(screenshotRoot, requestedWithExt);
      if (!isInside(screenshotRoot, absolutePath)) {
        absolutePath = resolve(screenshotRoot, basename(absolutePath));
        pathRewritten = true;
      }
    }
  }

  await mkdir(dirname(absolutePath), { recursive: true });

  const displayPath = isAbsolute(requested || '')
    ? absolutePath.replace(/\\/g, '/')
    : relative(projectRoot, absolutePath).replace(/\\/g, '/');
  return { absolutePath, displayPath, pathRewritten };
}
