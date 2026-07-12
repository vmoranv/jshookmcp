/**
 * asar_repack — pack a directory tree back into an Electron ASAR archive.
 *
 * Inverse of `asar_extract`: walks the input directory, builds the ASAR header
 * JSON (nested `files` tree) + concatenated data segment, and emits the 4×UInt32LE
 * pickle prefix that {@link parseAsarBuffer} decodes. Closes the unpack → patch →
 * repack → retest loop so users no longer have to leave jshookmcp for the
 * `@electron/asar` pack step.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import type { ToolResponse } from '@server/types';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import {
  parseStringArg,
  pathExists,
  walkDirectory,
  resolveOutputDirectory,
  toDisplayPath,
} from '@server/domains/platform/handlers/platform-utils';
import {
  buildAsarBuffer,
  type AsarPackEntry,
} from '@server/domains/platform/handlers/electron-asar-helpers';

export async function handleAsarRepack(args: Record<string, unknown>): Promise<ToolResponse> {
  return handleSafe(async () => {
    const inputDir = parseStringArg(args, 'inputDir', true);
    if (!inputDir) {
      throw new Error('inputDir must be a non-empty string');
    }

    const absInputDir = resolve(inputDir);
    if (!(await pathExists(absInputDir))) {
      return {
        success: false,
        tool: 'asar_repack',
        error: `Directory does not exist: ${inputDir}`,
      };
    }

    // Collect every regular file under inputDir (walkDirectory already filters
    // non-files / unreadable entries) and read it into a buffer.
    const entries: AsarPackEntry[] = [];
    await walkDirectory(absInputDir, async (absolutePath) => {
      const data = await readFile(absolutePath);
      const relativePath = relative(absInputDir, absolutePath).replace(/\\/g, '/');
      entries.push({ path: relativePath, data });
    });

    // Resolve the output path. If the caller supplies outputPath, use it verbatim
    // (creating parent directories as needed); otherwise generate one under the
    // artifacts tmp tree named after the source directory.
    const outputPathArg = parseStringArg(args, 'outputPath');
    let outputPath: string;
    if (outputPathArg) {
      outputPath = resolve(outputPathArg);
      await mkdir(dirname(outputPath), { recursive: true });
    } else {
      const outputDir = await resolveOutputDirectory('asar-repack', basename(absInputDir));
      outputPath = resolve(outputDir.absolutePath, `${basename(absInputDir)}.asar`);
    }

    const { buffer, fileCount, totalDataSize } = buildAsarBuffer(entries);
    await writeFile(outputPath, buffer);

    return {
      success: true,
      tool: 'asar_repack',
      inputDir: toDisplayPath(absInputDir),
      outputPath: toDisplayPath(outputPath),
      fileCount,
      totalDataSize,
      asarSize: buffer.length,
    };
  });
}
