/**
 * electron_scan_userdata — Scans a directory for JSON files
 * and returns their raw content. Cross-platform: Agent provides the
 * appropriate path (Windows %APPDATA%, macOS ~/Library/Application Support,
 * Linux ~/.config, etc.).
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, sep } from 'node:path';
import { readEnvString } from '@src/config/environment';
import { ToolError } from '@errors/ToolError';
import type { ToolResponse } from '@server/types';
import { parseStringArg, pathExists } from '@server/domains/platform/handlers/platform-utils';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';

/**
 * Directories this tool may read from.
 *
 * The tool exists to inspect Electron app state, but an unconstrained `dirPath`
 * turns it into an arbitrary JSON-file reader (and a 100 MB-per-file memory
 * amplifier). Roots default to the platform app-data locations; operators add
 * their own with JSHOOK_USERDATA_ROOTS (path-delimiter separated).
 */
function allowedUserdataRoots(): string[] {
  const configured = readEnvString('JSHOOK_USERDATA_ROOTS', '').trim();
  if (configured.length > 0) {
    // Explicit configuration is an allowlist, not an addition: operators who
    // set JSHOOK_USERDATA_ROOTS intentionally narrow the readable surface.
    return configured
      .split(delimiter)
      .map((root) => root.trim())
      .filter((root) => root.length > 0);
  }

  const home = homedir();
  return [
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    join(home, 'Library', 'Application Support'),
    join(home, '.config'),
  ].filter((root): root is string => typeof root === 'string' && root.length > 0);
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

/** Resolve symlinks, then require the real target to sit under an allowed root. */
async function resolveAllowedUserdataDir(dirPath: string): Promise<string> {
  const roots = allowedUserdataRoots();
  if (roots.length === 0) {
    throw new ToolError(
      'PREREQUISITE',
      'No userdata root is configured. Set JSHOOK_USERDATA_ROOTS to the app-data directory to inspect.',
    );
  }

  let realDir: string;
  try {
    realDir = await realpath(dirPath);
  } catch {
    throw new ToolError('VALIDATION', `Cannot resolve directory: ${dirPath}`);
  }

  for (const root of roots) {
    try {
      const realRoot = await realpath(root);
      if (isInside(realRoot, realDir)) return realDir;
    } catch {
      // Unreadable/nonexistent configured root: skip it rather than fail closed
      // on an unrelated entry.
    }
  }

  throw new ToolError(
    'VALIDATION',
    `dirPath is outside the allowed userdata roots. Allowed: ${roots.join(', ')}`,
  );
}

interface ScannedFile {
  name: string;
  sizeBytes: number;
  content: unknown;
}

interface SkippedFile {
  name: string;
  reason: string;
}

export async function handleElectronScanUserdata(
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const dirPath = parseStringArg(args, 'dirPath', true);
    if (!dirPath) {
      throw new Error('dirPath is required');
    }

    const maxFiles = typeof args.maxFiles === 'number' && args.maxFiles > 0 ? args.maxFiles : 20;
    const maxFileSizeKB =
      typeof args.maxFileSizeKB === 'number' && args.maxFileSizeKB > 0 ? args.maxFileSizeKB : 1024;
    const maxFileSize = maxFileSizeKB * 1024;

    // Resolve first: every subsequent read uses the realpath, so a symlink
    // cannot redirect the scan outside the allowlist after the check.
    const safeDirPath = await resolveAllowedUserdataDir(dirPath);

    if (!(await pathExists(safeDirPath))) {
      return { success: false, error: `Directory does not exist: ${dirPath}` };
    }

    const dirStat = await stat(safeDirPath);
    if (!dirStat.isDirectory()) {
      return { success: false, error: `Path is not a directory: ${dirPath}` };
    }

    let dirEntries: string[];
    try {
      dirEntries = await readdir(safeDirPath);
    } catch {
      return { success: false, error: `Cannot read directory: ${dirPath}` };
    }

    const jsonFiles = dirEntries.filter((name) => name.endsWith('.json')).slice(0, maxFiles);

    const files: ScannedFile[] = [];
    const skipped: SkippedFile[] = [];

    for (const fileName of jsonFiles) {
      const filePath = join(safeDirPath, fileName);
      try {
        // Resolve the file itself: a symlink inside an allowed directory can
        // point at any JSON file on disk. Reject targets that escape the root.
        const realFilePath = await realpath(filePath);
        if (!isInside(safeDirPath, realFilePath)) {
          skipped.push({ name: fileName, reason: 'symlink escapes allowed root' });
          continue;
        }
        const fileStat = await stat(realFilePath);
        if (!fileStat.isFile()) {
          skipped.push({ name: fileName, reason: 'not a file' });
          continue;
        }
        if (fileStat.size > maxFileSize) {
          skipped.push({ name: fileName, reason: 'exceeds maxFileSizeKB' });
          continue;
        }
        const raw = await readFile(realFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        files.push({
          name: fileName,
          sizeBytes: fileStat.size,
          content: parsed,
        });
      } catch {
        skipped.push({ name: fileName, reason: 'read or parse error' });
      }
    }

    return {
      files,
      skipped,
      totalScanned: jsonFiles.length,
      directory: safeDirPath,
    };
  });
}
