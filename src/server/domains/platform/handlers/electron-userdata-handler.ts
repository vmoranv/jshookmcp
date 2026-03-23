/**
 * electron_scan_userdata — Scans a directory for JSON files
 * and returns their raw content. Cross-platform: Agent provides the
 * appropriate path (Windows %APPDATA%, macOS ~/Library/Application Support,
 * Linux ~/.config, etc.).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
  pathExists,
} from '@server/domains/platform/handlers/platform-utils';

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
  args: Record<string, unknown>
): Promise<ReturnType<typeof toTextResponse>> {
  try {
    const dirPath = parseStringArg(args, 'dirPath', true);
    if (!dirPath) {
      throw new Error('dirPath is required');
    }

    const maxFiles =
      typeof args.maxFiles === 'number' && args.maxFiles > 0
        ? args.maxFiles
        : 20;
    const maxFileSizeKB =
      typeof args.maxFileSizeKB === 'number' && args.maxFileSizeKB > 0
        ? args.maxFileSizeKB
        : 1024;
    const maxFileSize = maxFileSizeKB * 1024;

    if (!(await pathExists(dirPath))) {
      return toTextResponse({
        success: false,
        tool: 'electron_scan_userdata',
        error: `Directory does not exist: ${dirPath}`,
      });
    }

    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) {
      return toTextResponse({
        success: false,
        tool: 'electron_scan_userdata',
        error: `Path is not a directory: ${dirPath}`,
      });
    }

    let dirEntries: string[];
    try {
      dirEntries = await readdir(dirPath);
    } catch {
      return toTextResponse({
        success: false,
        tool: 'electron_scan_userdata',
        error: `Cannot read directory: ${dirPath}`,
      });
    }

    const jsonFiles = dirEntries
      .filter((name) => name.endsWith('.json'))
      .slice(0, maxFiles);

    const files: ScannedFile[] = [];
    const skipped: SkippedFile[] = [];

    for (const fileName of jsonFiles) {
      const filePath = join(dirPath, fileName);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          skipped.push({ name: fileName, reason: 'not a file' });
          continue;
        }
        if (fileStat.size > maxFileSize) {
          skipped.push({ name: fileName, reason: 'exceeds maxFileSizeKB' });
          continue;
        }
        const raw = await readFile(filePath, 'utf-8');
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

    return toTextResponse({
      success: true,
      tool: 'electron_scan_userdata',
      files,
      skipped,
      totalScanned: jsonFiles.length,
      directory: dirPath,
    });
  } catch (error) {
    return toErrorResponse('electron_scan_userdata', error);
  }
}
