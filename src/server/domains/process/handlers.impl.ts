/**
 * Process tool handlers — composition facade.
 *
 * Delegates to three sub-handler modules:
 *   - ProcessManagementHandlers: process find/get/windows/kill/debug launch
 *   - MemoryOperationHandlers:   memory read/write/scan/audit/protection/dump/regions
 *   - InjectionHandlers:         DLL/shellcode injection, check_debug_port, enumerate_modules, electron_attach
 */

import { UnifiedProcessManager, MemoryManager } from '@server/domains/shared/modules';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { logger } from '@utils/logger';
import type { ProcessHandlerDeps } from './handlers/shared-types';
import { ProcessManagementHandlers } from './handlers/process-management';
import { MemoryOperationHandlers } from './handlers/memory-operations';
import { InjectionHandlers } from './handlers/injection-handlers';
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

function createDeps(): ProcessHandlerDeps {
  const processManager = new UnifiedProcessManager();
  const memoryManager = new MemoryManager();
  const platform = processManager.getPlatform();
  const auditTrail = new MemoryAuditTrail();
  return { processManager, memoryManager, auditTrail, platform };
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
  protected _deps: ProcessHandlerDeps;

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

  constructor() {
    this._deps = createDeps();
    logger.info(`ProcessToolHandlers initialized for platform: ${this._deps.platform}`);
    this.processMgmt = new ProcessManagementHandlers(this._deps);
    this.memoryOps = new MemoryOperationHandlers(this._deps, this.processMgmt);

    // Bind diagnostic helpers from the shared processMgmt instance
    this.buildMemoryDiagnostics = this.processMgmt.buildMemoryDiagnostics.bind(this.processMgmt);
    this.safeBuildMemoryDiagnostics = this.processMgmt.safeBuildMemoryDiagnostics.bind(
      this.processMgmt,
    );
    this.recordMemoryAudit = this.processMgmt.recordMemoryAudit.bind(this.processMgmt);
  }

  // ── Process Management ──

  async handleProcessFind(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessFind(args);
  }

  async handleProcessGet(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessGet(args);
  }

  async handleProcessWindows(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessWindows(args);
  }

  async handleProcessCheckDebugPort(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessCheckDebugPort(args);
  }

  async handleProcessLaunchDebug(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessLaunchDebug(args);
  }

  async handleProcessKill(args: Record<string, unknown>) {
    return this.processMgmt.handleProcessKill(args);
  }

  // ── Memory Operations ──

  async handleMemoryRead(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryRead(args);
  }

  async handleMemoryWrite(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryWrite(args);
  }

  async handleMemoryScan(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryScan(args);
  }

  async handleMemoryAuditExport(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryAuditExport(args);
  }

  async handleMemoryCheckProtection(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryCheckProtection(args);
  }

  async handleMemoryScanFiltered(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryScanFiltered(args);
  }

  async handleMemoryBatchWrite(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryBatchWrite(args);
  }

  async handleMemoryDumpRegion(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryDumpRegion(args);
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

  constructor() {
    super();
    // Re-use the same deps and processMgmt from the base class
    this.injection = new InjectionHandlers(this._deps, this.processMgmt);
  }

  // ── Injection Handlers ──

  async handleInjectDll(args: Record<string, unknown>) {
    return this.injection.handleInjectDll(args);
  }

  async handleInjectShellcode(args: Record<string, unknown>) {
    return this.injection.handleInjectShellcode(args);
  }

  async handleCheckDebugPort(args: Record<string, unknown>) {
    return this.injection.handleCheckDebugPort(args);
  }

  async handleEnumerateModules(args: Record<string, unknown>) {
    return this.injection.handleEnumerateModules(args);
  }

  async handleElectronAttach(args: Record<string, unknown>) {
    return this.injection.handleElectronAttach(args);
  }
}

/**
 * ProcessToolHandlersRuntime — backward-compatible alias used by inject tests.
 * Same class as ProcessToolHandlers (the facade) since it covers all methods.
 */
export { ProcessToolHandlers as ProcessToolHandlersRuntime };
