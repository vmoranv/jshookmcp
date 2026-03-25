/**
 * EvidenceGraphBridge — maps InstrumentationSession events to evidence graph nodes.
 *
 * Requirement: EVID-04
 *
 * Called by InstrumentationSessionManager when operations are registered
 * and artifacts are captured, automatically populating the evidence graph.
 */
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { InstrumentationOperation, InstrumentationArtifact } from './types';

export class EvidenceGraphBridge {
  /** Maps operationId → evidence node ID for edge linking. */
  private readonly operationNodeMap = new Map<string, string>();

  constructor(private readonly graph: ReverseEvidenceGraph) {}

  /**
   * Called when a new operation is registered.
   * Creates evidence node(s) based on operation type.
   * Returns the primary evidence node ID (or null if no mapping).
   */
  onOperation(op: InstrumentationOperation): string | null {
    let primaryNodeId: string | null = null;

    switch (op.type) {
      case 'runtime-hook': {
        // Create function + breakpoint-hook nodes linked by 'triggers'
        const funcNode = this.graph.addNode('function', op.target, {
          functionName: op.target,
          sessionId: op.sessionId,
          operationId: op.id,
        });
        const hookNode = this.graph.addNode('breakpoint-hook', `hook:${op.target}`, {
          hookType: 'runtime-hook',
          sessionId: op.sessionId,
          operationId: op.id,
          config: op.config,
        });
        this.graph.addEdge(funcNode.id, hookNode.id, 'triggers');
        primaryNodeId = hookNode.id;
        break;
      }

      case 'network-intercept': {
        // Create request node
        const reqNode = this.graph.addNode('request', op.target, {
          url: op.target,
          sessionId: op.sessionId,
          operationId: op.id,
          config: op.config,
        });
        primaryNodeId = reqNode.id;
        break;
      }

      case 'function-trace': {
        // Create function node
        const funcNode = this.graph.addNode('function', op.target, {
          functionName: op.target,
          sessionId: op.sessionId,
          operationId: op.id,
          traceMode: true,
        });
        primaryNodeId = funcNode.id;
        break;
      }

      case 'before-load-inject': {
        // Create script node
        const scriptNode = this.graph.addNode('script', op.target, {
          injectionPoint: 'before-load',
          sessionId: op.sessionId,
          operationId: op.id,
        });
        primaryNodeId = scriptNode.id;
        break;
      }
    }

    if (primaryNodeId) {
      this.operationNodeMap.set(op.id, primaryNodeId);
    }

    return primaryNodeId;
  }

  /**
   * Called when an artifact is captured.
   * Creates a captured-data node and links it to the operation's evidence node.
   */
  onArtifact(artifact: InstrumentationArtifact): void {
    const operationNodeId = this.operationNodeMap.get(artifact.operationId);

    const dataNode = this.graph.addNode('captured-data', `data:${artifact.operationId}`, {
      sessionId: artifact.sessionId,
      operationId: artifact.operationId,
      artifactType: artifact.type,
      ...artifact.data,
    });

    // Link operation node → captured-data if we have the mapping
    if (operationNodeId) {
      this.graph.addEdge(operationNodeId, dataNode.id, 'captures');
    }
  }
}
