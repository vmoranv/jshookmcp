/**
 * Process management handlers — find/get/windows/findChromium/checkDebugPort/launchDebug/kill.
 *
 * Also provides buildMemoryDiagnostics and recordMemoryAudit helpers
 * shared by other sub-handlers via deps.
 */

import { logger } from '@utils/logger';
import { argNumber, argStringArray } from '@server/domains/shared/parse-args';
import type { MemoryManager } from '@server/domains/shared/modules';
import type { ProcessHandlerDeps } from './shared-types';
import type { AuditEntry } from './shared-types';
import {
  validatePid,
  requireString,
  type ProcessSummarySource,
  type ProcessWindowSource,
  type MemoryDiagnosticsInput,
  type MemoryDiagnostics,
} from '../handlers.base.types';

export class ProcessManagementHandlers {
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
    const recommendedActions = new Set<string>();
    const permission = await this.memoryManager.checkAvailability();

    if (!permission.available) {
      recommendedActions.add('Run as administrator');
    }

    const processInfo = await this.resolveProcessInfo(input.pid);
    if (input.pid !== undefined && input.pid !== null && !processInfo) {
      recommendedActions.add('Check if process is still running');
    }

    const protectionResult = await this.queryProtection(input);
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

    const modulesInfo = await this.enumerateModulesSafe(input.pid);

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

    const aslrNote = modulesInfo.enumerated
      ? modulesInfo.count && modulesInfo.count > 0
        ? `Enumerated ${modulesInfo.count} module(s). Treat absolute addresses as session-specific because ASLR can shift module bases between launches.`
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
