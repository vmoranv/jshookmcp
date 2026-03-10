import { UnifiedProcessManager, MemoryManager } from '@server/domains/shared/modules';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { logger } from '@utils/logger';

interface ProcessSummarySource {
  pid: number;
  name: string;
  executablePath?: string;
  windowTitle?: string;
  windowHandle?: string;
  memoryUsage?: number;
}

interface ProcessWindowSource {
  handle: string;
  title: string;
  className: string;
  processId: number;
}

interface MemoryDiagnosticsInput {
  pid?: number;
  address?: string;
  size?: number;
  operation: string;
  error?: string;
}

interface MemoryDiagnostics {
  permission: {
    available: boolean;
    reason?: string;
    platform: string;
  };
  process: {
    exists: boolean | null;
    pid: number | null;
    name: string | null;
  };
  address: {
    queried: boolean;
    valid: boolean | null;
    protection: string | null;
    regionStart: string | null;
    regionSize: number | null;
  };
  aslr: {
    heuristic: true;
    note: string;
  };
  recommendedActions: string[];
}

/** Validate an arg is a positive integer PID. */
export function validatePid(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid PID: ${JSON.stringify(value)}`);
  return n;
}

/** Validate an arg is a non-empty string. */
export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

/** Validate an arg is a positive number. */
export function requirePositiveNumber(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

export class ProcessToolHandlersBase {
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

  protected async buildMemoryDiagnostics(input: MemoryDiagnosticsInput): Promise<MemoryDiagnostics> {
    const recommendedActions = new Set<string>();
    const permission = await this.memoryManager.checkAvailability();

    if (!permission.available) {
      recommendedActions.add('Run as administrator');
    }

    let processInfo: ProcessSummarySource | null = null;
    if (input.pid != null) {
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
    if (input.pid != null && input.address) {
      try {
        protectionInfo = await this.memoryManager.checkMemoryProtection(input.pid, input.address);
      } catch {
        protectionQueryFailed = true;
      }

      if (protectionQueryFailed || protectionInfo?.success === false) {
        recommendedActions.add('Verify address is within valid memory region');
      }
    }

    if (input.size != null && protectionInfo?.regionSize != null && input.size > protectionInfo.regionSize) {
      recommendedActions.add('Reduce the requested size to fit the target memory region');
    }

    if (input.operation === 'memory_read' && protectionInfo?.success && protectionInfo.isReadable === false) {
      recommendedActions.add('Ensure target memory region is readable');
    }

    if (input.operation === 'memory_write' && protectionInfo?.success && protectionInfo.isWritable === false) {
      recommendedActions.add('Ensure target memory region is writable');
    }

    let modulesEnumerated = false;
    let moduleCount: number | null = null;
    if (input.pid != null) {
      try {
        const modulesResult = await this.memoryManager.enumerateModules(input.pid);
        modulesEnumerated = modulesResult.success;
        moduleCount = modulesResult.modules?.length ?? null;
      } catch {
        modulesEnumerated = false;
      }
    }

    if (input.pid != null && input.address) {
      recommendedActions.add('Re-resolve the address after the process restarts because ASLR can shift module addresses');
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
        exists: input.pid != null ? Boolean(processInfo) : null,
        pid: input.pid ?? null,
        name: processInfo?.name ?? null,
      },
      address: {
        queried: input.pid != null && Boolean(input.address),
        valid: input.pid != null && input.address ? protectionInfo?.success ?? null : null,
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
              2
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
              2
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
                2
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
              2
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
              2
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
              2
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleProcessFindChromium(_args: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              disabled: true,
              message:
                'process_find_chromium is disabled to avoid scanning user-installed browser processes.',
              guidance: [
                'Use browser_launch(driver="chrome"|"camoufox") to start a managed browser session.',
                'Use browser_attach/browser_launch(mode="connect") with an explicit browserURL/wsEndpoint.',
                'Use process_launch_debug for explicitly targeted Electron/Chromium executables.',
              ],
              platform: this.platform,
            },
            null,
            2
          ),
        },
      ],
    };
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
              2
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleProcessLaunchDebug(args: Record<string, unknown>) {
    try {
      const executablePath = requireString(args.executablePath, 'executablePath');
      const debugPort = (args.debugPort as number) || 9222;
      const argsList = (args.args as string[]) || [];

      const process = await this.processManager.launchWithDebug(executablePath, debugPort, argsList);

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
                2
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
              2
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
              2
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
                message: killed ? `Process ${pid} killed successfully` : `Failed to kill process ${pid}`,
              },
              null,
              2
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
              2
            ),
          },
        ],
      };
    }
  }
}
