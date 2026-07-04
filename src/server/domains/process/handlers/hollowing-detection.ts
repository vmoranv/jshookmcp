/**
 * Process Hollowing Detection Handler
 *
 * Detects process hollowing attacks where malware unmaps the original process image
 * and injects malicious code. Compares process memory sections with on-disk PE file.
 */

import { argNumber, argBool } from '@server/domains/shared/parse-args';
import { PEAnalyzer } from '@native/PEAnalyzer';
import {
  openProcessForMemory,
  CloseHandle,
  EnumProcessModules,
  GetModuleFileNameEx,
  GetModuleInformation,
} from '@native/Win32API';
import { logger } from '@utils/logger';

export class HollowingDetectionHandlers {
  private peAnalyzer = new PEAnalyzer();

  async handleDetectHollowing(args: Record<string, unknown>) {
    try {
      const pid = argNumber(args, 'pid');
      if (!pid || pid <= 0) {
        throw new Error('pid must be a positive integer');
      }
      const autoRestore = argBool(args, 'autoRestore', false);
      // includeMemoryDump is reserved for future use (e.g., forensic analysis)
      // const includeMemoryDump = argBool(args, 'includeMemoryDump', false);

      // 1. Open process handle
      const hProcess = openProcessForMemory(pid);

      try {
        // 2. Enumerate process modules
        const modulesResult = EnumProcessModules(hProcess);
        if (!modulesResult.success || modulesResult.modules.length === 0) {
          return {
            success: false,
            isHollowed: false,
            confidence: 0,
            error: 'No modules found in target process (process may have exited)',
          };
        }

        const mainModuleHandle = modulesResult.modules[0]!;
        const moduleBaseHex = `0x${mainModuleHandle.toString(16)}`;

        // 3. Get module file path
        const diskPath = GetModuleFileNameEx(hProcess, mainModuleHandle);
        if (!diskPath) {
          return {
            success: false,
            isHollowed: false,
            confidence: 0,
            error: 'Failed to get module path (process may have exited or access denied)',
            moduleBase: moduleBaseHex,
          };
        }

        // 4. Get module info
        const moduleInfoResult = GetModuleInformation(hProcess, mainModuleHandle);
        if (!moduleInfoResult.success) {
          return {
            success: false,
            isHollowed: false,
            confidence: 0,
            error: 'Failed to get module information',
            moduleBase: moduleBaseHex,
            modulePath: diskPath,
          };
        }

        // 5. Compare memory with disk
        let comparisonResult;
        try {
          comparisonResult = await this.peAnalyzer.compareMemoryWithDisk(
            pid,
            moduleBaseHex,
            diskPath,
          );
        } catch (error) {
          return {
            success: false,
            isHollowed: false,
            confidence: 0,
            error: `Failed to compare memory with disk: ${error instanceof Error ? error.message : String(error)}`,
            moduleBase: moduleBaseHex,
            modulePath: diskPath,
          };
        }

        const isHollowed = !comparisonResult.isMatch;

        // 6. Optional: Auto-restore from disk (HIGH RISK)
        let restored = false;
        let restoreError: string | undefined;

        if (autoRestore && isHollowed) {
          logger.warn(
            `[process_detect_hollowing] autoRestore=true for PID ${pid} - attempting restoration (HIGH RISK)`,
          );
          try {
            restored = await this.restoreFromDisk(
              pid,
              mainModuleHandle,
              diskPath,
              comparisonResult.differences,
            );
          } catch (error) {
            restoreError = `Restoration failed: ${error instanceof Error ? error.message : String(error)}`;
            logger.error(`[process_detect_hollowing] Restoration failed for PID ${pid}:`, error);
          }
        }

        // 7. Build result
        return {
          success: true,
          isHollowed,
          confidence: comparisonResult.confidence,
          modulePath: diskPath,
          moduleBase: moduleBaseHex,
          moduleSizeOfImage: moduleInfoResult.info.SizeOfImage,
          differences: comparisonResult.differences.map((d) => ({
            section: d.sectionName,
            offset: `0x${d.offsetStart.toString(16)}`,
            size: d.bytesCompared,
            memoryHash: d.memoryHash.substring(0, 16) + '...', // Truncate for readability
            diskHash: d.diskHash.substring(0, 16) + '...',
          })),
          restored,
          restoreError,
          warning: autoRestore
            ? 'HIGH RISK: Memory restoration attempted. Target process may crash or behave unexpectedly.'
            : isHollowed
              ? 'Process appears to be hollowed. Use autoRestore=true to attempt restoration (HIGH RISK).'
              : undefined,
        };
      } finally {
        CloseHandle(hProcess);
      }
    } catch (error) {
      return {
        success: false,
        isHollowed: false,
        confidence: 0,
        error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Restore original code from disk to process memory.
   * WARNING: This is a HIGH RISK operation that modifies the target process.
   */
  private async restoreFromDisk(
    pid: number,
    moduleBase: bigint,
    diskPath: string,
    differences: Array<{ sectionName: string; offsetStart: number; bytesCompared: number }>,
  ): Promise<boolean> {
    // Import MemoryController and Win32API functions (used in restoration scope only)
    const { promises: fs } = await import('node:fs');
    const win32 = await import('@native/Win32API');

    const hProcess = win32.openProcessForMemory(pid, true);

    try {
      // Read disk PE file
      const diskBuffer = await fs.readFile(diskPath);
      const diskPE = this.peAnalyzer.parsePEFromBuffer(diskBuffer);

      // Restore each differing section
      for (const diff of differences) {
        const diskSection = diskPE.sections.find((s) => s.name === diff.sectionName);
        if (!diskSection) {
          logger.warn(
            `[restoreFromDisk] Section ${diff.sectionName} not found in disk PE, skipping`,
          );
          continue;
        }

        // Read original bytes from disk
        const originalBytes = diskBuffer.subarray(
          diskSection.pointerToRawData,
          diskSection.pointerToRawData + Math.min(diskSection.sizeOfRawData, diff.bytesCompared),
        );

        const targetAddr = moduleBase + BigInt(diff.offsetStart);

        // Change protection to writable
        const { oldProtect } = win32.VirtualProtectEx(
          hProcess,
          targetAddr,
          originalBytes.length,
          win32.PAGE.READWRITE,
        );

        // Write original bytes back
        win32.WriteProcessMemory(hProcess, targetAddr, originalBytes);

        // Restore original protection
        win32.VirtualProtectEx(hProcess, targetAddr, originalBytes.length, oldProtect);

        logger.info(
          `[restoreFromDisk] Restored section ${diff.sectionName} (${originalBytes.length} bytes) at 0x${targetAddr.toString(16)}`,
        );
      }

      return true;
    } catch (error) {
      logger.error('[restoreFromDisk] Restoration failed:', error);
      throw error;
    } finally {
      win32.CloseHandle(hProcess);
    }
  }
}
