/**
 * Process tool handlers — composition facade.
 *
 * Delegates to three sub-handler modules:
 *   - ProcessManagementHandlers: process find/get/windows/kill/debug launch
 *   - MemoryOperationHandlers:   memory read/write/scan/audit/protection/dump/regions
 *   - InjectionHandlers:         DLL/shellcode injection, check_debug_port, enumerate_modules, electron_attach
 */

import { UnifiedProcessManager, MemoryManager } from '@server/domains/shared/modules/native';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { logger } from '@utils/logger';
import type { ProcessHandlerDeps } from './handlers/shared-types';
import { ProcessManagementHandlers } from './handlers/process-management';
import { MemoryOperationHandlers } from './handlers/memory-operations';
import { InjectionHandlers } from './handlers/injection-handlers';
import { HollowingDetectionHandlers } from './handlers/hollowing-detection';
import { HandleEnumerationHandlers } from './handlers/handle-enumeration';
import { ApcDetectionHandlers } from './handlers/apc-detection';
import { ProcessSuspendHandlers } from './handlers/process-suspend';
import { scanHollowingIndicators } from './handlers/hollowing-scan';
import {
  validatePid,
  requireString,
  requirePositiveNumber,
  type MemoryDiagnosticsInput,
  type MemoryDiagnostics,
} from './handlers.base.types';
import type { AuditEntry } from './handlers/shared-types';

export { validatePid, requireString, requirePositiveNumber };
export { ProcessManagementHandlers, MemoryOperationHandlers, InjectionHandlers };

// ── Shared deps factory ──

function createDeps(
  ctx?: import('@server/MCPServer.context').MCPServerContext,
): ProcessHandlerDeps {
  const processManager = new UnifiedProcessManager();
  const memoryManager = new MemoryManager();
  const platform = processManager.getPlatform();
  const auditTrail = new MemoryAuditTrail();
  return { processManager, memoryManager, auditTrail, platform, ctx };
}

/**
 * ProcessHandlersBase — backward-compatible class for tests.
 * Exposes process management + memory operation methods.
 * Matches the old ProcessHandlersBase which extended ProcessHandlersCore
 * and added all memory handlers.
 */
export class ProcessHandlersBase {
  protected processMgmt: ProcessManagementHandlers;
  protected memoryOps: MemoryOperationHandlers;
  protected deps: ProcessHandlerDeps;

  // Diagnostic helpers exposed for test subclasses
  protected buildMemoryDiagnostics!: (input: MemoryDiagnosticsInput) => Promise<MemoryDiagnostics>;
  protected safeBuildMemoryDiagnostics!: (input: {
    pid?: number;
    address?: string;
    size?: number;
    operation: string;
    error?: string;
  }) => Promise<unknown>;
  protected recordMemoryAudit!: (entry: Omit<AuditEntry, 'timestamp' | 'user'>) => void;

  constructor(ctx?: import('@server/MCPServer.context').MCPServerContext) {
    this.deps = createDeps(ctx);
    logger.info(`ProcessToolHandlers initialized for platform: ${this.deps.platform}`);
    this.processMgmt = new ProcessManagementHandlers(this.deps);
    this.memoryOps = new MemoryOperationHandlers(this.deps, this.processMgmt);

    // Bind diagnostic helpers from the shared processMgmt instance
    this.buildMemoryDiagnostics = this.processMgmt.buildMemoryDiagnostics.bind(this.processMgmt);
    this.safeBuildMemoryDiagnostics = this.processMgmt.safeBuildMemoryDiagnostics.bind(
      this.processMgmt,
    );
    this.recordMemoryAudit = this.processMgmt.recordMemoryAudit.bind(this.processMgmt);
  }

  // ── Process Management ──

  async handleProcessFindTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessFind(args));
  }

  async handleProcessFind(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessFind(args);
  }

  async handleProcessGetTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessGet(args));
  }

  async handleProcessGet(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessGet(args);
  }

  async handleProcessKillTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessKill(args));
  }

  async handleProcessKill(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessKill(args);
  }

  async handleProcessWindowsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessWindows(args));
  }

  async handleProcessWindows(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessWindows(args);
  }

  async handleProcessCheckDebugPortTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessCheckDebugPort(args));
  }

  async handleProcessCheckDebugPort(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessCheckDebugPort(args);
  }

  async handleProcessLaunchDebugTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessLaunchDebug(args));
  }

  async handleProcessLaunchDebug(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessLaunchDebug(args);
  }

  // ── Memory Operations ──

  async handleMemoryReadTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryRead(args));
  }

  async handleMemoryRead(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryRead(args);
  }

  async handleMemoryWriteTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryWrite(args));
  }

  async handleMemoryWrite(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryWrite(args);
  }

  async handleMemoryScanTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryScan(args));
  }

  async handleMemoryScan(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryScan(args);
  }

  async handleMemoryAuditExportTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryAuditExport(args));
  }

  async handleMemoryAuditExport(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryAuditExport(args);
  }

  async handleMemoryCheckProtectionTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryCheckProtection(args));
  }

  async handleMemoryCheckProtection(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryCheckProtection(args);
  }

  async handleMemoryScanFilteredTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryScanFiltered(args));
  }

  async handleMemoryScanFiltered(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryScanFiltered(args);
  }

  async handleMemoryBatchWriteTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryBatchWrite(args));
  }

  async handleMemoryBatchWrite(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryBatchWrite(args);
  }

  async handleMemoryDumpRegionTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryDumpRegion(args));
  }

  async handleMemoryDumpRegion(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryDumpRegion(args);
  }

  async handleMemoryListRegionsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMemoryListRegions(args));
  }

  async handleMemoryListRegions(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryListRegions(args);
  }
}

/**
 * ProcessToolHandlers — main facade class used by the manifest.
 * Adds injection handlers on top of ProcessHandlersBase.
 */
export class ProcessToolHandlers extends ProcessHandlersBase {
  private injection: InjectionHandlers;
  private hollowing: HollowingDetectionHandlers;
  private handleEnum: HandleEnumerationHandlers;
  private apcDetection: ApcDetectionHandlers;
  private processSuspend: ProcessSuspendHandlers;

  constructor(ctx?: import('@server/MCPServer.context').MCPServerContext) {
    super(ctx);
    // Re-use the same deps and processMgmt from the base class
    this.injection = new InjectionHandlers(this.deps, this.processMgmt);
    this.hollowing = new HollowingDetectionHandlers(this.processMgmt);
    this.handleEnum = new HandleEnumerationHandlers(this.processMgmt);
    this.apcDetection = new ApcDetectionHandlers(this.deps);
    this.processSuspend = new ProcessSuspendHandlers(this.processMgmt);
  }

  // ── Injection Handlers ──

  async handleInjectDllTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInjectDll(args));
  }

  async handleInjectDll(args: Record<string, unknown>) {
    return this.injection.handleInjectDll(args);
  }

  async handleInjectShellcodeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInjectShellcode(args));
  }

  async handleInjectShellcode(args: Record<string, unknown>) {
    return this.injection.handleInjectShellcode(args);
  }

  async handleCheckDebugPortTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCheckDebugPort(args));
  }

  async handleCheckDebugPort(args: Record<string, unknown>) {
    return this.injection.handleCheckDebugPort(args);
  }

  async handleEnumerateModulesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleEnumerateModules(args));
  }

  async handleEnumerateModules(args: Record<string, unknown>) {
    return this.injection.handleEnumerateModules(args);
  }

  async handleProcessEnumThreadsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessEnumThreads(args));
  }

  async handleProcessEnumThreads(args: Record<string, unknown>) {
    return this.injection.handleProcessEnumThreads(args);
  }

  async handleElectronAttachTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronAttach(args));
  }

  async handleElectronAttach(args: Record<string, unknown>) {
    return this.injection.handleElectronAttach(args);
  }

  // ── Hollowing Detection ──

  async handleDetectHollowingTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleDetectHollowing(args));
  }

  async handleDetectHollowing(args: Record<string, unknown>) {
    return this.hollowing.handleDetectHollowing(args);
  }

  // ── Hollowing Scan (pure-TS static) ──

  async handleHollowingScanTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => this.handleHollowingScan(args));
  }

  async handleHollowingScan(args: Record<string, unknown>) {
    return scanHollowingIndicators({
      pid: typeof args.pid === 'number' ? args.pid : undefined,
      mapsContent: typeof args.mapsContent === 'string' ? args.mapsContent : undefined,
      exeLink: typeof args.exeLink === 'string' ? args.exeLink : undefined,
      peHex: typeof args.peHex === 'string' ? args.peHex : undefined,
      expectedImagePath:
        typeof args.expectedImagePath === 'string' ? args.expectedImagePath : undefined,
    });
  }

  // ── Handle Enumeration ──

  async handleProcessEnumHandlesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessEnumHandles(args));
  }

  async handleProcessEnumHandles(args: Record<string, unknown>) {
    return this.handleEnum.handleProcessEnumHandles(args);
  }

  // ── APC Detection ──

  async handleProcessDetectApcTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessDetectApc(args));
  }

  async handleProcessDetectApc(args: Record<string, unknown>) {
    return this.apcDetection.handleProcessDetectApc(args);
  }

  // ── Process Suspend/Resume ──

  async handleProcessSuspendTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessSuspend(args));
  }

  async handleProcessSuspend(args: Record<string, unknown>) {
    return this.processSuspend.handleProcessSuspend(args);
  }

  async handleProcessResumeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcessResume(args));
  }

  async handleProcessResume(args: Record<string, unknown>) {
    return this.processSuspend.handleProcessResume(args);
  }
}

/**
 * ProcessToolHandlersRuntime — backward-compatible alias used by inject tests.
 * Same class as ProcessToolHandlers (the facade) since it covers all methods.
 */
export { ProcessToolHandlers as ProcessToolHandlersRuntime };
