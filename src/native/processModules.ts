/**
 * PSAPI-backed module enumeration for a remote process.
 *
 * This walk (EnumProcessModules → GetModuleBaseName / GetModuleInformation /
 * GetModuleFileNameEx) was duplicated verbatim in AntiCheatDetector and
 * PEAnalyzer. Kept in one place so the failure handling — an unreadable module
 * is skipped, the walk never throws — stays uniform across callers.
 */
import { logger } from '@utils/logger';
import {
  EnumProcessModules,
  GetModuleBaseName,
  GetModuleFileNameEx,
  GetModuleInformation,
} from './Win32API';

export interface ProcessModuleEntry {
  name: string;
  /** Base address as a hex string, e.g. "0x7ff6...". */
  base: string;
  path: string;
  /** Mapped image size in bytes. */
  size: number;
}

/**
 * Enumerate the modules mapped into `hProcess`.
 *
 * Fail-soft: if the PSAPI call throws, an empty list is returned and the
 * failure is logged at debug level — callers treat "no modules" and "cannot
 * read modules" the same way.
 */
export function enumerateProcessModules(hProcess: bigint): ProcessModuleEntry[] {
  const modules: ProcessModuleEntry[] = [];

  try {
    const { modules: modHandles, count } = EnumProcessModules(hProcess);
    for (let i = 0; i < count; i++) {
      const hMod = modHandles[i]!;
      const name = GetModuleBaseName(hProcess, hMod);
      const info = GetModuleInformation(hProcess, hMod);
      const modulePath = GetModuleFileNameEx(hProcess, hMod) ?? name;

      if (info.success) {
        modules.push({
          name,
          base: `0x${info.info.lpBaseOfDll.toString(16)}`,
          path: modulePath,
          size: info.info.SizeOfImage,
        });
      }
    }
  } catch (e) {
    logger.debug(`Module enumeration failed: ${e}`);
  }

  return modules;
}
