import { UnifiedProcessManager, MemoryManager } from '@server/domains/shared/modules';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { logger } from '@utils/logger';
import { argNumber, argStringArray } from '@server/domains/shared/parse-args';
import type { AuditEntry } from '@modules/process/memory/AuditTrail';

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

type MemoryPatternType = 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string';

const MEMORY_PATTERN_TYPES: Set<MemoryPatternType> = new Set([
  'hex',
  'int32',
  'int64',
  'float',
  'double',
  'string',
]);

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

function normalizePatternType(value: unknown): MemoryPatternType {
  if (typeof value === 'string' && MEMORY_PATTERN_TYPES.has(value as MemoryPatternType)) {
    return value as MemoryPatternType;
  }
  return 'hex';
}

function getOptionalPid(value: unknown): number | undefined {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getOptionalPositiveNumber(value: unknown): number | undefined {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? size : undefined;
}

function getWriteSize(data: string, encoding: 'hex' | 'base64'): number {
  if (encoding === 'hex') {
    const normalized = data.replace(/\s+/g, '');
    return Math.ceil(normalized.length / 2);
  }

  return Buffer.from(data, 'base64').length;
}

export class ProcessHandlersBase {
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
    input: MemoryDiagnosticsInput
  ): Promise<MemoryDiagnostics> {
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

    if (
      input.size != null &&
      protectionInfo?.regionSize != null &&
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
      recommendedActions.add(
        'Re-resolve the address after the process restarts because ASLR can shift module addresses'
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
        exists: input.pid != null ? Boolean(processInfo) : null,
        pid: input.pid ?? null,
        name: processInfo?.name ?? null,
      },
      address: {
        queried: input.pid != null && Boolean(input.address),
        valid: input.pid != null && input.address ? (protectionInfo?.success ?? null) : null,
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

  // ===== Base Process Handler Methods =====

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
      const debugPort = argNumber(args, 'debugPort', 9222);
      const argsList = argStringArray(args, 'args');

      const process = await this.processManager.launchWithDebug(
        executablePath,
        debugPort,
        argsList
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
                message: killed
                  ? `Process ${pid} killed successfully`
                  : `Failed to kill process ${pid}`,
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

  // ===== Memory Handler Methods =====

  async handleMemoryRead(args: Record<string, unknown>) {
    const startedAt = Date.now();
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');
      const size = requirePositiveNumber(args.size, 'size');

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        const errorMessage = availability.reason ?? 'Memory operations not available';
        const diagnostics = await this.safeBuildMemoryDiagnostics({
          pid,
          address,
          size,
          operation: 'memory_read',
          error: errorMessage,
        });
        this.recordMemoryAudit({
          operation: 'memory_read',
          pid,
          address,
          size,
          result: 'failure',
          error: errorMessage,
          durationMs: Date.now() - startedAt,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedAddress: address,
                  requestedSize: size,
                  pid,
                  diagnostics,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.readMemory(pid, address, size);
      const diagnostics = !result.success
        ? await this.safeBuildMemoryDiagnostics({
            pid,
            address,
            size,
            operation: 'memory_read',
            error: result.error,
          })
        : undefined;
      this.recordMemoryAudit({
        operation: 'memory_read',
        pid,
        address,
        size,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      const payload: Record<string, unknown> = {
        success: result.success,
        data: result.data,
        error: result.error,
        pid,
        address,
        size,
        platform: this.platform,
      };

      if (!result.success) {
        payload.diagnostics = diagnostics;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory read failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const pid = getOptionalPid(args.pid);
      const address = getOptionalString(args.address);
      const size = getOptionalPositiveNumber(args.size);
      const diagnostics = await this.safeBuildMemoryDiagnostics({
        pid,
        address,
        size,
        operation: 'memory_read',
        error: errorMessage,
      });
      this.recordMemoryAudit({
        operation: 'memory_read',
        pid: pid ?? null,
        address: address ?? null,
        size: size ?? null,
        result: 'failure',
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMessage,
                diagnostics,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryWrite(args: Record<string, unknown>) {
    const startedAt = Date.now();
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');
      const data = requireString(args.data, 'data');
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';
      const size = getWriteSize(data, encoding);

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        const errorMessage = availability.reason ?? 'Memory operations not available';
        const diagnostics = await this.safeBuildMemoryDiagnostics({
          pid,
          address,
          size,
          operation: 'memory_write',
          error: errorMessage,
        });
        this.recordMemoryAudit({
          operation: 'memory_write',
          pid,
          address,
          size,
          result: 'failure',
          error: errorMessage,
          durationMs: Date.now() - startedAt,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedAddress: address,
                  dataLength: data != null ? data.length : 0,
                  encoding,
                  pid,
                  diagnostics,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.writeMemory(pid, address, data, encoding);
      const diagnostics = !result.success
        ? await this.safeBuildMemoryDiagnostics({
            pid,
            address,
            size,
            operation: 'memory_write',
            error: result.error,
          })
        : undefined;
      this.recordMemoryAudit({
        operation: 'memory_write',
        pid,
        address,
        size,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      const payload: Record<string, unknown> = {
        success: result.success,
        bytesWritten: result.bytesWritten,
        error: result.error,
        pid,
        address,
        dataLength: data.length,
        encoding,
        platform: this.platform,
      };

      if (!result.success) {
        payload.diagnostics = diagnostics;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory write failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const pid = getOptionalPid(args.pid);
      const address = getOptionalString(args.address);
      const data = getOptionalString(args.data);
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';
      const size = data ? getWriteSize(data, encoding) : undefined;
      const diagnostics = await this.safeBuildMemoryDiagnostics({
        pid,
        address,
        size,
        operation: 'memory_write',
        error: errorMessage,
      });
      this.recordMemoryAudit({
        operation: 'memory_write',
        pid: pid ?? null,
        address: address ?? null,
        size: size ?? null,
        result: 'failure',
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMessage,
                diagnostics,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryScan(args: Record<string, unknown>) {
    const startedAt = Date.now();
    try {
      const pid = validatePid(args.pid);
      const pattern = requireString(args.pattern, 'pattern');
      const patternType = normalizePatternType(args.patternType);

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        const errorMessage = availability.reason ?? 'Memory operations not available';
        const diagnostics = await this.safeBuildMemoryDiagnostics({
          pid,
          operation: 'memory_scan',
          error: errorMessage,
        });
        this.recordMemoryAudit({
          operation: 'memory_scan',
          pid,
          address: null,
          size: null,
          result: 'failure',
          error: errorMessage,
          durationMs: Date.now() - startedAt,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedPattern: pattern,
                  patternType,
                  pid,
                  diagnostics,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.scanMemory(pid, pattern, patternType);
      const diagnostics = !result.success
        ? await this.safeBuildMemoryDiagnostics({
            pid,
            operation: 'memory_scan',
            error: result.error,
          })
        : undefined;
      this.recordMemoryAudit({
        operation: 'memory_scan',
        pid,
        address: null,
        size: null,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      const payload: Record<string, unknown> = {
        success: result.success,
        addresses: result.addresses,
        error: result.error,
        pid,
        pattern,
        patternType,
        platform: this.platform,
      };

      if (!result.success) {
        payload.diagnostics = diagnostics;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory scan failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const pid = getOptionalPid(args.pid);
      const diagnostics = await this.safeBuildMemoryDiagnostics({
        pid,
        operation: 'memory_scan',
        error: errorMessage,
      });
      this.recordMemoryAudit({
        operation: 'memory_scan',
        pid: pid ?? null,
        address: null,
        size: null,
        result: 'failure',
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: errorMessage,
                diagnostics,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryAuditExport(args: Record<string, unknown>) {
    try {
      const exportedJson = this.auditTrail.exportJson();
      const entries = JSON.parse(exportedJson) as unknown[];
      const clear = args.clear === true;
      const count = this.auditTrail.size();

      if (clear) {
        this.auditTrail.clear();
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                count,
                cleared: clear,
                entries,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory audit export failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryCheckProtection(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');

      const result = await this.memoryManager.checkMemoryProtection(pid, address);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory check protection failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryScanFiltered(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const pattern = requireString(args.pattern, 'pattern');
      const addresses = args.addresses as string[];
      const patternType = normalizePatternType(args.patternType);

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.scanMemoryFiltered(
        pid,
        pattern,
        addresses,
        patternType
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory scan filtered failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryBatchWrite(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const patches = args.patches as {
        address: string;
        data: string;
        encoding?: 'hex' | 'base64';
      }[];

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.batchMemoryWrite(pid, patches);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory batch write failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryDumpRegion(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const address = requireString(args.address, 'address');
      const size = requirePositiveNumber(args.size, 'size');
      const outputPath = requireString(args.outputPath, 'outputPath');

      if (/^[/\\]/.test(outputPath) || /\.\./.test(outputPath) || /^[A-Za-z]:/.test(outputPath)) {
        throw new Error(
          'outputPath must be a relative path without parent directory traversal or drive letters'
        );
      }

      const result = await this.memoryManager.dumpMemoryRegion(pid, address, size, outputPath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory dump region failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryListRegions(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);

      const result = await this.memoryManager.enumerateRegions(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory list regions failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
