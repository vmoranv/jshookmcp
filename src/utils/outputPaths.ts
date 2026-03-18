import { mkdir } from 'node:fs/promises';
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

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const projectRoot = resolve(currentDir, '..', '..');

function isInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return false;
  }
  return true;
}

function resolveWithinProject(inputPath: string): string {
  const candidate = isAbsolute(inputPath) ? normalize(inputPath) : resolve(projectRoot, inputPath);
  return isInside(projectRoot, candidate)
    ? candidate
    : resolve(
        projectRoot,
        'screenshots',
        'external',
        normalize(inputPath).split(/[\\/]/).pop() || 'output.bin'
      );
}

function withDefaultExtension(filePath: string, extension: string): string {
  if (extname(filePath)) {
    return filePath;
  }
  return `${filePath}.${extension.replace(/^\./, '')}`;
}

export function getProjectRoot(): string {
  return projectRoot;
}

export function resolveOutputDirectory(
  inputDir: string | undefined,
  fallbackDir = 'screenshots'
): string {
  const requested = inputDir?.trim();
  if (!requested) {
    return resolve(projectRoot, fallbackDir);
  }

  const resolved = resolveWithinProject(requested);
  if (isInside(projectRoot, resolved)) {
    return resolved;
  }
  return resolve(projectRoot, fallbackDir);
}

export async function resolveScreenshotOutputPath(options: {
  requestedPath?: string;
  type?: 'png' | 'jpeg';
  fallbackName?: string;
  fallbackDir?: string;
}): Promise<{ absolutePath: string; displayPath: string; pathRewritten: boolean }> {
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
