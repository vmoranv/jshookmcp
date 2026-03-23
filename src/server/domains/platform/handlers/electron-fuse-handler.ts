/**
 * electron_check_fuses — Detects Electron fuse configuration from binary.
 * Reads the fuse wire sentinel directly from the executable, no npm dependency.
 */

import { readFile } from 'node:fs/promises';
import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
  pathExists,
} from '@server/domains/platform/handlers/platform-utils';

/**
 * The Electron fuse sentinel string embedded in Electron binaries.
 */
const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZIA';

/** Fuse names in the order they appear after the sentinel. */
const FUSE_NAMES = [
  'RunAsNode',
  'EnableCookieEncryption',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar',
  'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges',
] as const;

/** Fuse byte values. */
const FUSE_VALUES: Record<number, string> = {
  0x30: 'DISABLE',  // ASCII '0'
  0x31: 'ENABLE',   // ASCII '1'
  0x72: 'REMOVED',  // ASCII 'r'
};

export async function handleElectronCheckFuses(
  args: Record<string, unknown>
): Promise<ReturnType<typeof toTextResponse>> {
  try {
    const exePath = parseStringArg(args, 'exePath', true);
    if (!exePath) {
      throw new Error('exePath is required');
    }

    if (!(await pathExists(exePath))) {
      return toTextResponse({
        success: false,
        tool: 'electron_check_fuses',
        error: `File does not exist: ${exePath}`,
      });
    }

    // Read the binary
    const buffer = await readFile(exePath);
    const sentinelBuffer = Buffer.from(FUSE_SENTINEL, 'ascii');
    const sentinelIndex = buffer.indexOf(sentinelBuffer);

    if (sentinelIndex === -1) {
      return toTextResponse({
        success: true,
        tool: 'electron_check_fuses',
        exePath,
        fuseWireFound: false,
        fuses: {},
        note: 'No fuse sentinel found. This may not be an Electron binary, or fuses are not configured.',
      });
    }

    // Read fuse bytes after the sentinel
    const fuseDataStart = sentinelIndex + sentinelBuffer.length;
    const fuses: Record<string, string> = {};

    for (let i = 0; i < FUSE_NAMES.length; i++) {
      const fuseName = FUSE_NAMES[i];
      if (!fuseName) continue;
      const byteIndex = fuseDataStart + i;
      if (byteIndex >= buffer.length) {
        fuses[fuseName] = 'UNKNOWN';
        continue;
      }
      const byteValue = buffer[byteIndex];
      if (byteValue === undefined) {
        fuses[fuseName] = 'UNKNOWN';
        continue;
      }
      fuses[fuseName] = FUSE_VALUES[byteValue] ?? 'UNKNOWN';
    }

    return toTextResponse({
      success: true,
      tool: 'electron_check_fuses',
      exePath,
      fuseWireFound: true,
      fuses,
    });
  } catch (error) {
    return toErrorResponse('electron_check_fuses', error);
  }
}
