/**
 * Shared dependencies interface for process domain sub-handlers.
 *
 * Each sub-handler receives these deps via constructor injection,
 * enabling composition over inheritance.
 */

import type { AuditEntry } from '@modules/process/memory/AuditTrail';
import type { UnifiedProcessManager, MemoryManager } from '@server/domains/shared/modules';
import type { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';

export interface ProcessHandlerDeps {
  processManager: UnifiedProcessManager;
  memoryManager: MemoryManager;
  auditTrail: MemoryAuditTrail;
  platform: string;
}

export type { AuditEntry };
