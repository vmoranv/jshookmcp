import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import {
  basename,
  extname,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import { homedir } from 'node:os';
import type { CodeCollector } from '../../../../modules/collector/CodeCollector.js';
import { resolveArtifactPath } from '../../../../utils/artifacts.js';
import { logger } from '../../../../utils/logger.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type FsStats = Awaited<ReturnType<typeof stat>>;

export interface MiniappPkgScanItem {
  path: string;
  size: number;
  appId: string | null;
  lastModified: string;
}

export interface MiniappPkgEntry {
  name: string;
  offset: number;
  size: number;
}

export interface ParsedMiniappPkg {
  magic: number;
  info: number;
  indexInfoLength: number;
  dataLength: number;
  lastIdent: number;
  dataOffset: number;
  entries: MiniappPkgEntry[];
}

export interface AsarFileEntry {
  path: string;
  size: number;
  offset: number;
  unpacked: boolean;
}

export interface ParsedAsar {
  files: AsarFileEntry[];
  dataOffset: number;
  headerSize: number;
  headerStringSize: number;
  headerContentSize: number;
  padding: number;
}

// ---------------------------------------------------------------------------
// Shared utility functions (standalone, no class needed)
// ---------------------------------------------------------------------------

export function toTextResponse(payload: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function toErrorResponse(
  tool: string,
  error: unknown,
  extra: Record<string, unknown> = {}
) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

export function getCollectorState(collector: CodeCollector): string {
  void collector;
  return 'attached';
}

export function parseStringArg(
  args: Record<string, unknown>,
  key: string,
  required = false
): string | undefined {
  const value = args[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  if (required) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return undefined;
}

export function parseBooleanArg(
  args: Record<string, unknown>,
  key: string,
  defaultValue: boolean
): boolean {
  const value = args[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        output.push(trimmed);
      }
    }
  }
  return output;
}

export function toDisplayPath(absolutePath: string): string {
  const relPath = relative(process.cwd(), absolutePath).replace(/\\/g, '/');
  if (relPath.length === 0) {
    return '.';
  }
  return relPath.startsWith('..') ? absolutePath.replace(/\\/g, '/') : relPath;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function getDefaultSearchPaths(): string[] {
  const userProfile = process.env.USERPROFILE ?? homedir();
  const appData =
    process.env.APPDATA ?? join(userProfile, 'AppData', 'Roaming');

  // Scan common miniapp platform cache directories
  // Paths are platform-generic; actual subdirectories vary by vendor
  const candidates = [join(userProfile, 'Documents'), join(appData)];

  // Walk one level to find known miniapp cache subdirectory patterns
  const knownSubPatterns = ['Applet', 'XPlugin', 'MiniApp'];
  const resolvedPaths: string[] = [];

  for (const base of candidates) {
    for (const sub of knownSubPatterns) {
      resolvedPaths.push(resolve(base, sub));
    }
  }

  return Array.from(new Set(resolvedPaths));
}

export async function walkDirectory(
  rootDir: string,
  onFile: (absolutePath: string, fileStats: FsStats) => Promise<void>
): Promise<void> {
  const stack: string[] = [resolve(rootDir)];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    let entries: import('node:fs').Dirent[];
    try {
      entries = (await readdir(currentDir, {
        withFileTypes: true,
      })) as unknown as import('node:fs').Dirent[];
    } catch (error) {
      logger.debug('walkDirectory skip unreadable directory', {
        currentDir,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const entry of entries) {
      const absolutePath = join(currentDir, String(entry.name));

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const fileStats = await stat(absolutePath);
        await onFile(absolutePath, fileStats);
      } catch (error) {
        logger.warn('walkDirectory skip unreadable file', {
          absolutePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export async function resolveOutputDirectory(
  toolName: string,
  target: string,
  requestedDir?: string
): Promise<{ absolutePath: string; displayPath: string }> {
  if (requestedDir) {
    const absolutePath = resolve(requestedDir);
    await mkdir(absolutePath, { recursive: true });
    return { absolutePath, displayPath: toDisplayPath(absolutePath) };
  }

  const { absolutePath: markerPath, displayPath: markerDisplayPath } =
    await resolveArtifactPath({
      category: 'tmp',
      toolName,
      target,
      ext: 'tmpdir',
    });

  const generatedDir = markerPath.replace(/\.tmpdir$/i, '');
  await mkdir(generatedDir, { recursive: true });

  return {
    absolutePath: generatedDir,
    displayPath: markerDisplayPath.replace(/\.tmpdir$/i, ''),
  };
}

export function sanitizeArchiveRelativePath(rawPath: string): string {
  const normalizedPath = normalize(rawPath.replace(/\\/g, '/')).replace(
    /\\/g,
    '/'
  );
  const segments = normalizedPath
    .split('/')
    .filter(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    );

  return segments.join('/');
}

export function resolveSafeOutputPath(
  rootDir: string,
  rawRelativePath: string
): string {
  const sanitized = sanitizeArchiveRelativePath(rawRelativePath);
  const fallbackName = basename(rawRelativePath) || 'unnamed.bin';
  const safeRelative = sanitized.length > 0 ? sanitized : fallbackName;
  const outputPath = resolve(rootDir, safeRelative);

  const normalizedRoot = resolve(rootDir);
  if (
    outputPath !== normalizedRoot &&
    !outputPath.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error(`Path traversal blocked: ${rawRelativePath}`);
  }

  return outputPath;
}

export async function readJsonFileSafe(
  filePath: string
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function checkExternalCommand(
  command: string,
  versionArgs: string[],
  label: string
) {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const { stdout, stderr } = await execFileAsync(command, versionArgs, {
      timeout: 10_000,
    });
    const version = (stdout || stderr).trim().split('\n')[0] ?? '';

    return toTextResponse({
      success: true,
      tool: label,
      available: true,
      version,
    });
  } catch (error) {
    return toTextResponse({
      success: true,
      tool: label,
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      installHint:
        label === 'frida'
          ? 'pip install frida-tools'
          : 'https://github.com/skylot/jadx/releases',
    });
  }
}

export function extractAppIdFromPath(filePath: string): string | null {
  const normalizedPath = filePath.replace(/\\/g, '/');

  const pathPatterns = [
    /\/([a-zA-Z]{2,4}[a-zA-Z0-9]{6,})\//,  // Generic miniapp ID pattern (2-4 letter prefix + alphanumeric)
    /\/Applet\/([^/]+)\//i,                   // Generic applet directory
  ];

  for (const pattern of pathPatterns) {
    const match = normalizedPath.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  const base = basename(filePath, extname(filePath));
  const fileMatch = base.match(/([a-zA-Z]{2,4}[a-zA-Z0-9]{6,})/);
  if (fileMatch?.[1]) {
    return fileMatch[1];
  }

  return null;
}
