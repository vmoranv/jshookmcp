/**
 * Process management handlers — find/get/windows/findChromium/checkDebugPort/launchDebug/kill.
 *
 * Also provides buildMemoryDiagnostics and recordMemoryAudit helpers
 * shared by other sub-handlers via deps.
 */

import { logger } from '@utils/logger';
import { argNumber, argStringArray } from '@server/domains/shared/parse-args';
import { DEFAULT_DEBUG_PORT } from '@src/constants/server';
import { isChromiumLikeExecutable } from '@modules/process/chromium-launch';
import type { MemoryManager } from '@server/domains/shared/modules/native';
import type { AuditEntry, MemoryOperationHost, ProcessHandlerDeps } from './shared-types';
import {
  validatePid,
  requireString,
  type ProcessSummarySource,
  type ProcessWindowSource,
  type MemoryDiagnosticsInput,
  type MemoryDiagnostics,
} from '../handlers.base.types';

export class ProcessManagementHandlers implements MemoryOperationHost {
  private processManager;
  private memoryManager;
  private platform: string;
  private auditTrail;

  constructor(deps: ProcessHandlerDeps) {
    this.processManager = deps.processManager;
    this.memoryManager = deps.memoryManager;
    this.platform = deps.platform;
    this.auditTrail = deps.auditTrail;
  }

  // ── Diagnostic helpers (used by other sub-handlers) ──

  async buildMemoryDiagnostics(input: MemoryDiagnosticsInput): Promise<MemoryDiagnostics> {
    const permission = await this.memoryManager.checkAvailability();
    const processInfo = await this.resolveProcessInfo(input.pid);
    const protectionResult = await this.queryProtection(input);
    const modulesInfo = await this.enumerateModulesSafe(input.pid);

    const recommendedActions = collectMemoryDiagnosticActions(input, {
      permission,
      processInfo,
      protectionResult,
    });
    const aslrNote = describeAslrNote(modulesInfo);

    return {
      permission: {
        available: permission.available,
        reason: permission.reason,
        platform: this.platform,
      },
      process: {
        exists: input.pid !== undefined && input.pid !== null ? Boolean(processInfo) : null,
        pid: input.pid ?? null,
        name: processInfo?.name ?? null,
      },
      address: {
        queried: input.pid !== undefined && input.pid !== null && Boolean(input.address),
        valid:
          input.pid !== undefined && input.pid !== null && input.address
            ? (protectionResult.info?.success ?? null)
            : null,
        protection: protectionResult.info?.protection ?? null,
        regionStart: protectionResult.info?.regionStart ?? null,
        regionSize: protectionResult.info?.regionSize ?? null,
      },
      aslr: {
        heuristic: true,
        note: aslrNote,
      },
      recommendedActions: Array.from(recommendedActions),
    };
  }

  async safeBuildMemoryDiagnostics(input: {
    pid?: number;
    address?: string;
    size?: number;
    operation: string;
    error?: string;
  }): Promise<unknown> {
    try {
      return await this.buildMemoryDiagnostics(input);
    } catch (diagnosticError) {
      logger.warn('Memory diagnostics generation failed:', diagnosticError);
      return undefined;
    }
  }

  recordMemoryAudit(entry: Omit<AuditEntry, 'timestamp' | 'user'>): void {
    try {
      this.auditTrail.record(entry);
    } catch (auditError) {
      logger.warn('Memory audit trail recording failed:', auditError);
    }
  }

  get platformValue(): string {
    return this.platform;
  }

  exportMemoryAuditEntries(): unknown[] {
    return JSON.parse(this.auditTrail.exportJson()) as unknown[];
  }

  clearMemoryAuditEntries(): void {
    this.auditTrail.clear();
  }

  getMemoryAuditCount(): number {
    return this.auditTrail.size();
  }

  // ── Process Handler Methods ──

  async handleProcessList(_args: Record<string, unknown>) {
    try {
      const processes = await this.processManager.findProcesses('');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                count: processes.length,
                processes: processes.map((p: ProcessSummarySource) => ({
                  pid: p.pid,
                  name: p.name,
                  path: p.executablePath,
                  windowTitle: p.windowTitle,
                  windowHandle: p.windowHandle,
                  memoryMB: p.memoryUsage ? Math.round(p.memoryUsage / 1024 / 1024) : undefined,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process list failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleProcessFind(args: Record<string, unknown>) {
    try {
      const pattern = requireString(args.pattern, 'pattern');
      const processes = await this.processManager.findProcesses(pattern);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                pattern,
                count: processes.length,
                processes: processes.map((p: ProcessSummarySource) => ({
                  pid: p.pid,
                  name: p.name,
                  path: p.executablePath,
                  windowTitle: p.windowTitle,
                  windowHandle: p.windowHandle,
                  memoryMB: p.memoryUsage ? Math.round(p.memoryUsage / 1024 / 1024) : undefined,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process find failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleProcessGet(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const process = await this.processManager.getProcessByPid(pid);

      if (!process) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: `Process with PID ${pid} not found`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const cmdLine = await this.processManager.getProcessCommandLine(pid);
      const debugPort = await this.processManager.checkDebugPort(pid, {
        commandLine: cmdLine.commandLine,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                process: {
                  ...process,
                  commandLine: cmdLine.commandLine,
                  parentPid: cmdLine.parentPid,
                  debugPort,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process get failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleProcessWindows(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const windows = await this.processManager.getProcessWindows(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                pid,
                windowCount: windows.length,
                windows: windows.map((w: ProcessWindowSource) => ({
                  handle: w.handle,
                  title: w.title,
                  className: w.className,
                  processId: w.processId,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process windows failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleProcessCheckDebugPort(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const debugPort = await this.processManager.checkDebugPort(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                pid,
                debugPort,
                canAttach: debugPort !== null,
                attachUrl: debugPort ? `http://localhost:${debugPort}` : null,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Check debug port failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleProcessLaunchDebug(args: Record<string, unknown>) {
    try {
      const executablePath = requireString(args.executablePath, 'executablePath');
      const debugPort = argNumber(args, 'debugPort', DEFAULT_DEBUG_PORT);
      const argsList = argStringArray(args, 'args');

      const process = await this.processManager.launchWithDebug(
        executablePath,
        debugPort,
        argsList,
      );

      if (!process) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Failed to launch process',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const debugPortSupported = isChromiumLikeExecutable(executablePath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                process: {
                  pid: process.pid,
                  name: process.name,
                  path: process.executablePath,
                },
                debugPort,
                debugPortSupported,
                // Only advertise an attach endpoint when the launch actually
                // enabled a debug port (Chromium-family targets only).
                attachUrl: debugPortSupported ? `http://localhost:${debugPort}` : null,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Launch debug failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleProcessKill(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const killed = await this.processManager.killProcess(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: killed,
                pid,
                message: killed
                  ? `Process ${pid} killed successfully`
                  : `Failed to kill process ${pid}`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process kill failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  // ── Private helpers ──

  private async resolveProcessInfo(pid?: number | null): Promise<ProcessSummarySource | null> {
    if (pid === undefined || pid === null) return null;
    try {
      const resolvedProcess = await this.processManager.getProcessByPid(pid);
      return resolvedProcess
        ? {
            pid: resolvedProcess.pid,
            name: resolvedProcess.name,
            executablePath: resolvedProcess.executablePath,
            windowTitle: resolvedProcess.windowTitle,
            windowHandle: resolvedProcess.windowHandle,
            memoryUsage: resolvedProcess.memoryUsage,
          }
        : null;
    } catch {
      return null;
    }
  }

  private async queryProtection(input: MemoryDiagnosticsInput) {
    if (input.pid === undefined || input.pid === null || !input.address) {
      return { info: null as null, queryFailed: false };
    }
    let queryFailed = false;
    let info: Awaited<ReturnType<MemoryManager['checkMemoryProtection']>> | null = null;
    try {
      info = await this.memoryManager.checkMemoryProtection(input.pid, input.address);
    } catch {
      queryFailed = true;
    }
    return { info, queryFailed };
  }

  private async enumerateModulesSafe(pid?: number | null) {
    if (pid === undefined || pid === null) {
      return { enumerated: false, count: null as number | null };
    }
    try {
      const modulesResult = await this.memoryManager.enumerateModules(pid);
      return {
        enumerated: modulesResult.success,
        count: modulesResult.modules?.length ?? null,
      };
    } catch {
      return { enumerated: false, count: null as number | null };
    }
  }
}

/** Collect the advisory actions for a memory operation, in the historical
 * order (a Set preserves first-insertion order in the response). */
function collectMemoryDiagnosticActions(
  input: MemoryDiagnosticsInput,
  ctx: {
    permission: { available: boolean };
    processInfo: { name?: string } | null | undefined;
    protectionResult: {
      queryFailed?: boolean;
      info?: {
        success?: boolean;
        isReadable?: boolean;
        isWritable?: boolean;
        regionSize?: number | null;
      } | null;
    };
  },
): Set<string> {
  const recommendedActions = new Set<string>();
  const { permission, processInfo, protectionResult } = ctx;
  const hasPid = input.pid !== undefined && input.pid !== null;

  if (!permission.available) {
    recommendedActions.add('Run as administrator');
  }
  if (hasPid && !processInfo) {
    recommendedActions.add('Check if process is still running');
  }
  if (protectionResult.queryFailed || protectionResult.info?.success === false) {
    recommendedActions.add('Verify address is within valid memory region');
  }
  if (
    input.size !== undefined &&
    input.size !== null &&
    protectionResult.info?.regionSize !== undefined &&
    protectionResult.info.regionSize !== null &&
    input.size > protectionResult.info.regionSize
  ) {
    recommendedActions.add('Reduce the requested size to fit the target memory region');
  }
  if (
    input.operation === 'memory_read' &&
    protectionResult.info?.success &&
    protectionResult.info.isReadable === false
  ) {
    recommendedActions.add('Ensure target memory region is readable');
  }
  if (
    input.operation === 'memory_write' &&
    protectionResult.info?.success &&
    protectionResult.info.isWritable === false
  ) {
    recommendedActions.add('Ensure target memory region is writable');
  }
  if (hasPid && input.address) {
    recommendedActions.add(
      'Re-resolve the address after the process restarts because ASLR can shift module addresses',
    );
  }

  const normalizedError = input.error?.toLowerCase() ?? '';
  if (
    normalizedError.includes('access denied') ||
    normalizedError.includes('permission') ||
    normalizedError.includes('privilege') ||
    normalizedError.includes('administrator')
  ) {
    recommendedActions.add('Run as administrator');
  }
  return recommendedActions;
}

/** Human-readable ASLR caveat keyed off module enumeration success. */
function describeAslrNote(modulesInfo: { enumerated: boolean; count?: number | null }): string {
  if (!modulesInfo.enumerated) {
    return (
      'Module enumeration was unavailable. Assume ASLR may shift absolute addresses between launches and ' +
      're-resolve addresses after restarts.'
    );
  }
  if (modulesInfo.count && modulesInfo.count > 0) {
    return (
      `Enumerated ${modulesInfo.count} module(s). Treat absolute addresses as session-specific because ASLR can ` +
      'shift module bases between launches.'
    );
  }
  return (
    'Module enumeration succeeded but returned no modules. Absolute addresses may still change across process' +
    ' launches because of ASLR.'
  );
}
