/**
 * ProcessHandlersCore — constructor, diagnostic helpers, and process management handlers.
 *
 * Covers: process find/get/windows/findChromium/checkDebugPort/launchDebug/kill.
 */

import { UnifiedProcessManager, MemoryManager } from '@server/domains/shared/modules';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { logger } from '@utils/logger';
import { argNumber, argStringArray } from '@server/domains/shared/parse-args';
import {
  validatePid,
  requireString,
  type ProcessSummarySource,
  type ProcessWindowSource,
  type MemoryDiagnosticsInput,
  type MemoryDiagnostics,
  type AuditEntry,
} from './handlers.base.types';

export class ProcessHandlersCore {
  protected processManager: UnifiedProcessManager;
  protected memoryManager: MemoryManager;
  protected platform: string;
  protected auditTrail = new MemoryAuditTrail();

  constructor() {
    this.processManager = new UnifiedProcessManager();
    this.memoryManager = new MemoryManager();
    this.platform = this.processManager.getPlatform();
    logger.info(`ProcessToolHandlers initialized for platform: ${this.platform}`);
  }

  protected async buildMemoryDiagnostics(
    input: MemoryDiagnosticsInput,
  ): Promise<MemoryDiagnostics> {
    const recommendedActions = new Set<string>();
    const permission = await this.memoryManager.checkAvailability();

    if (!permission.available) {
      recommendedActions.add('Run as administrator');
    }

    let processInfo: ProcessSummarySource | null = null;
    if (input.pid !== undefined && input.pid !== null) {
      try {
        const resolvedProcess = await this.processManager.getProcessByPid(input.pid);
        processInfo = resolvedProcess
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
        processInfo = null;
      }

      if (!processInfo) {
        recommendedActions.add('Check if process is still running');
      }
    }

    let protectionInfo: Awaited<ReturnType<MemoryManager['checkMemoryProtection']>> | null = null;
    let protectionQueryFailed = false;
    if (input.pid !== undefined && input.pid !== null && input.address) {
      try {
        protectionInfo = await this.memoryManager.checkMemoryProtection(input.pid, input.address);
      } catch {
        protectionQueryFailed = true;
      }

      if (protectionQueryFailed || protectionInfo?.success === false) {
        recommendedActions.add('Verify address is within valid memory region');
      }
    }

    if (
      input.size !== undefined &&
      input.size !== null &&
      protectionInfo?.regionSize !== undefined &&
      protectionInfo.regionSize !== null &&
      input.size > protectionInfo.regionSize
    ) {
      recommendedActions.add('Reduce the requested size to fit the target memory region');
    }

    if (
      input.operation === 'memory_read' &&
      protectionInfo?.success &&
      protectionInfo.isReadable === false
    ) {
      recommendedActions.add('Ensure target memory region is readable');
    }

    if (
      input.operation === 'memory_write' &&
      protectionInfo?.success &&
      protectionInfo.isWritable === false
    ) {
      recommendedActions.add('Ensure target memory region is writable');
    }

    let modulesEnumerated = false;
    let moduleCount: number | null = null;
    if (input.pid !== undefined && input.pid !== null) {
      try {
        const modulesResult = await this.memoryManager.enumerateModules(input.pid);
        modulesEnumerated = modulesResult.success;
        moduleCount = modulesResult.modules?.length ?? null;
      } catch {
        modulesEnumerated = false;
      }
    }

    if (input.pid !== undefined && input.pid !== null && input.address) {
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

    const aslrNote = modulesEnumerated
      ? moduleCount && moduleCount > 0
        ? `Enumerated ${moduleCount} module(s). Treat absolute addresses as session-specific because ASLR can shift module bases between launches.`
        : 'Module enumeration succeeded but returned no modules. Absolute addresses may still change across process launches because of ASLR.'
      : 'Module enumeration was unavailable. Assume ASLR may shift absolute addresses between launches and re-resolve addresses after restarts.';

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
            ? (protectionInfo?.success ?? null)
            : null,
        protection: protectionInfo?.protection ?? null,
        regionStart: protectionInfo?.regionStart ?? null,
        regionSize: protectionInfo?.regionSize ?? null,
      },
      aslr: {
        heuristic: true,
        note: aslrNote,
      },
      recommendedActions: Array.from(recommendedActions),
    };
  }

  protected async safeBuildMemoryDiagnostics(input: {
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

  protected recordMemoryAudit(entry: Omit<AuditEntry, 'timestamp' | 'user'>): void {
    try {
      this.auditTrail.record(entry);
    } catch (auditError) {
      logger.warn('Memory audit trail recording failed:', auditError);
    }
  }

  // ── Process Handler Methods ──

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
      const debugPort = argNumber(args, 'debugPort', 9222);
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
                attachUrl: `http://localhost:${debugPort}`,
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
}
