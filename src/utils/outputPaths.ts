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

const defaultProjectRoot = fileURLToPath(new URL('../..', import.meta.url));

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
  const configured = process.env.MCP_DEBUGGER_SESSIONS_DIR?.trim();
  if (configured) {
    return resolveOutputDirectory(configured, 'debugger-sessions');
  }

  return resolve(process.cwd(), 'debugger-sessions');
}

export function getExtensionRegistryDir(): string {
  return resolveOutputDirectory(
    process.env.MCP_EXTENSION_REGISTRY_DIR,
    'artifacts/extension-registry',
  );
}

export function getCodeCacheDir(): string {
  const configured = process.env.MCP_CODE_CACHE_DIR?.trim() || process.env.CACHE_DIR?.trim();
  if (configured) {
    return resolveOutputDirectory(configured, '.cache/code');
  }

  return resolve(getProjectRoot(), '.cache', 'code');
}

export function getTlsKeyLogDir(): string {
  return resolveOutputDirectory(process.env.MCP_TLS_KEYLOG_DIR, 'artifacts/tmp');
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
  const screenshotRoot = resolveOutputDirectory(process.env.MCP_SCREENSHOT_DIR, fallbackDir);
  const requested = options.requestedPath?.trim();

  let absolutePath: string;
  let pathRewritten = false;
  if (!requested) {
    absolutePath = resolve(screenshotRoot, `${fallbackName}-${Date.now()}.${extension}`);
    pathRewritten = true;
  } else {
    const requestedWithExt = withDefaultExtension(requested, extension);
    if (isAbsolute(requestedWithExt)) {
      // Honor user-provided absolute paths directly
      absolutePath = normalize(requestedWithExt);
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
