import type { DebuggerManager, PageController } from '@server/domains/shared/modules';
import type { CDPSessionLike, TraceRecorder } from '@modules/trace/TraceRecorder';
import type {
  EvidenceEdge,
  EvidenceEdgeType,
  EvidenceNode,
  EvidenceNodeType,
} from '@server/evidence/index';

export type { PageController, DebuggerManager, TraceRecorder, CDPSessionLike };

/**
 * Minimal evidence writer contract for canvas tracing.
 *
 * This intentionally stays narrower than ReverseEvidenceGraph so adapters can
 * record provenance without depending on the full graph implementation.
 */
export interface EvidenceStore {
  addNode(type: EvidenceNodeType, label: string, metadata?: Record<string, unknown>): EvidenceNode;
  addEdge(
    sourceId: string,
    targetId: string,
    type: EvidenceEdgeType,
    metadata?: Record<string, unknown>,
  ): EvidenceEdge;
  getNode(id: string): EvidenceNode | undefined;
}

/**
 * Cross-domain services required by the canvas domain runtime.
 */
export interface CanvasDomainDependencies {
  pageController: PageController;
  debuggerManager: DebuggerManager;
  traceRecorder: TraceRecorder;
  evidenceStore: EvidenceStore;
}
