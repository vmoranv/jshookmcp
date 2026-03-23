/**
 * electron_patch_fuses — Extends check_fuses with binary patching capability.
 * Patches Electron fuse sentinel to enable/disable debug-related fuses.
 * Creates backup before patching.
 */

import { readFile, writeFile, copyFile } from 'node:fs/promises';
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

/** Fuse byte values - ASCII-based. */
const FUSE_DISABLE = 0x30; // ASCII '0'
const FUSE_ENABLE = 0x31;  // ASCII '1'
const FUSE_REMOVED = 0x72; // ASCII 'r'

const FUSE_LABEL: Record<number, string> = {
  [FUSE_DISABLE]: 'DISABLE',
  [FUSE_ENABLE]: 'ENABLE',
  [FUSE_REMOVED]: 'REMOVED',
};

type FuseName = (typeof FUSE_NAMES)[number];

/** Default patch profile: enable debug-related fuses. */
const DEBUG_PATCH_PROFILE: Partial<Record<FuseName, 'ENABLE' | 'DISABLE'>> = {
  RunAsNode: 'ENABLE',
  EnableNodeOptionsEnvironmentVariable: 'ENABLE',
  EnableNodeCliInspectArguments: 'ENABLE',
  OnlyLoadAppFromAsar: 'DISABLE',
};

function parseFuses(buffer: Buffer, sentinelIndex: number): Record<string, string> {
  const fuseDataStart = sentinelIndex + Buffer.from(FUSE_SENTINEL, 'ascii').length;
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
    fuses[fuseName] = FUSE_LABEL[byteValue] ?? 'UNKNOWN';
  }
  return fuses;
}

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

    const fuses = parseFuses(buffer, sentinelIndex);

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

export async function handleElectronPatchFuses(
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
        tool: 'electron_patch_fuses',
        error: `File does not exist: ${exePath}`,
      });
    }

    const profile = parseStringArg(args, 'profile') ?? 'debug';
    const createBackup = (args.createBackup as boolean | undefined) !== false;

    // Determine which fuses to patch
    let patchMap: Partial<Record<FuseName, 'ENABLE' | 'DISABLE'>>;

    if (profile === 'debug') {
      patchMap = { ...DEBUG_PATCH_PROFILE };
    } else if (profile === 'custom') {
      const customFuses = args.fuses as Record<string, string> | undefined;
      if (!customFuses || Object.keys(customFuses).length === 0) {
        throw new Error('profile="custom" requires a `fuses` object mapping fuse names to ENABLE/DISABLE');
      }
      patchMap = {};
      for (const [name, value] of Object.entries(customFuses)) {
        if (!FUSE_NAMES.includes(name as FuseName)) {
          throw new Error(`Unknown fuse: ${name}. Valid: ${FUSE_NAMES.join(', ')}`);
        }
        if (value !== 'ENABLE' && value !== 'DISABLE') {
          throw new Error(`Invalid fuse value for ${name}: ${value}. Must be ENABLE or DISABLE`);
        }
        patchMap[name as FuseName] = value;
      }
    } else {
      throw new Error(`Unknown profile: ${profile}. Use "debug" or "custom"`);
    }

    // Read binary
    const buffer = await readFile(exePath);
    const sentinelBuffer = Buffer.from(FUSE_SENTINEL, 'ascii');
    const sentinelIndex = buffer.indexOf(sentinelBuffer);

    if (sentinelIndex === -1) {
      return toTextResponse({
        success: false,
        tool: 'electron_patch_fuses',
        error: 'No fuse sentinel found. This may not be an Electron binary.',
        exePath,
      });
    }

    // Read current state
    const fusesBefore = parseFuses(buffer, sentinelIndex);
    const fuseDataStart = sentinelIndex + sentinelBuffer.length;
    const changes: Array<{ fuse: string; before: string; after: string }> = [];

    // Apply patches
    for (const [fuseName, targetState] of Object.entries(patchMap)) {
      const fuseIndex = FUSE_NAMES.indexOf(fuseName as FuseName);
      if (fuseIndex === -1) continue;

      const byteIndex = fuseDataStart + fuseIndex;
      if (byteIndex >= buffer.length) continue;

      const currentByte = buffer[byteIndex];
      if (currentByte === FUSE_REMOVED) {
        // Cannot patch a removed fuse
        changes.push({ fuse: fuseName, before: 'REMOVED', after: 'REMOVED (cannot patch)' });
        continue;
      }

      const targetByte = targetState === 'ENABLE' ? FUSE_ENABLE : FUSE_DISABLE;
      const currentLabel = FUSE_LABEL[currentByte ?? 0] ?? 'UNKNOWN';

      if (currentByte === targetByte) {
        // Already in the desired state
        continue;
      }

      buffer[byteIndex] = targetByte;
      changes.push({ fuse: fuseName, before: currentLabel, after: targetState });
    }

    if (changes.length === 0) {
      return toTextResponse({
        success: true,
        tool: 'electron_patch_fuses',
        exePath,
        message: 'All target fuses are already in the desired state. No changes needed.',
        fuses: fusesBefore,
      });
    }

    // Create backup
    let backupPath: string | null = null;
    if (createBackup) {
      backupPath = `${exePath}.bak`;
      await copyFile(exePath, backupPath);
    }

    // Write patched binary
    await writeFile(exePath, buffer);

    // Read new state for verification
    const fusesAfter = parseFuses(buffer, sentinelIndex);

    return toTextResponse({
      success: true,
      tool: 'electron_patch_fuses',
      exePath,
      backupPath,
      profile,
      changes,
      fusesBefore,
      fusesAfter,
      note: backupPath
        ? `Backup created at ${backupPath}. Restore with: copy "${backupPath}" "${exePath}"`
        : 'No backup created (createBackup=false).',
    });
  } catch (error) {
    return toErrorResponse('electron_patch_fuses', error);
  }
}
