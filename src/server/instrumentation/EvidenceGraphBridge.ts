/**
 * EvidenceGraphBridge — maps InstrumentationSession events to evidence graph nodes.
 *
 * Requirement: EVID-04
 *
 * Called by InstrumentationSessionManager when operations are registered
 * and artifacts are captured, automatically populating the evidence graph.
 *
 * Full evidence chain coverage:
 *   request → initiator-stack (initiates)
 *   initiator-stack → script (loads)
 *   script → function (contains)
 *   function → breakpoint-hook (triggers)
 *   breakpoint-hook → captured-data (captures)
 *   captured-data → replay-artifact (replays)
 */
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { InstrumentationOperation, InstrumentationArtifact } from './types';

export class EvidenceGraphBridge {
  /** Maps operationId → primary evidence node ID for edge linking. */
  private readonly operationNodeMap = new Map<string, string>();
  /** Maps operationId → request node ID for manual linking / replay chaining. */
  private readonly requestNodeMap = new Map<string, string>();

  constructor(private readonly graph: ReverseEvidenceGraph) {}

  // ── Helpers ─────────────────────────────────────────────

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private getInitiatorLabel(config: Record<string, unknown>): string | undefined {
    const directInitiator = this.getString(config.initiator);
    if (directInitiator) return directInitiator;

    const directStack = this.getString(config.initiatorStack);
    if (directStack) return directStack;

    const initiator = config.initiator;
    if (initiator && typeof initiator === 'object') {
      const record = initiator as Record<string, unknown>;
      return (
        this.getString(record.stack) ??
        this.getString(record.url) ??
        this.getString(record.type) ??
        this.getString(record.name)
      );
    }

    return undefined;
  }

  // ── Public API ──────────────────────────────────────────

  /** Manually link a request node to an initiator-stack node. */
  linkRequestToInitiator(requestNodeId: string, initiatorStackNodeId: string): void {
    this.graph.addEdge(requestNodeId, initiatorStackNodeId, 'initiates');
  }

  /**
   * Called when a new operation is registered.
   * Creates evidence node(s) based on operation type.
   * Returns the primary evidence node ID (or null if no mapping).
   */
  onOperation(op: InstrumentationOperation): string | null {
    let primaryNodeId: string | null = null;

    switch (op.type) {
      case 'runtime-hook': {
        const funcNode = this.graph.addNode('function', op.target, {
          functionName: op.target,
          sessionId: op.sessionId,
          operationId: op.id,
        });

        // script → function (contains)
        const scriptId = this.getString(op.config.scriptId);
        if (scriptId) {
          const scriptNode = this.graph.addNode('script', `script:${scriptId}`, {
            scriptId,
            sessionId: op.sessionId,
            operationId: op.id,
          });
          this.graph.addEdge(scriptNode.id, funcNode.id, 'contains');
        }

        // function → breakpoint-hook (triggers)
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
        // request node
        const reqNode = this.graph.addNode('request', op.target, {
          url: op.target,
          sessionId: op.sessionId,
          operationId: op.id,
          config: op.config,
        });
        this.requestNodeMap.set(op.id, reqNode.id);

        // request → initiator-stack (initiates)
        const initiatorLabel = this.getInitiatorLabel(op.config);
        let initiatorNodeId: string | null = null;
        if (initiatorLabel) {
          const initiatorNode = this.graph.addNode('initiator-stack', initiatorLabel, {
            sessionId: op.sessionId,
            operationId: op.id,
            initiator: op.config.initiator,
            initiatorStack: op.config.initiatorStack,
          });
          this.linkRequestToInitiator(reqNode.id, initiatorNode.id);
          initiatorNodeId = initiatorNode.id;
        }

        // initiator-stack → script (loads)
        const initiatorScriptId = this.getString(op.config.initiatorScriptId);
        if (initiatorNodeId && initiatorScriptId) {
          const scriptNode = this.graph.addNode('script', `script:${initiatorScriptId}`, {
            scriptId: initiatorScriptId,
            sessionId: op.sessionId,
            operationId: op.id,
          });
          this.graph.addEdge(initiatorNodeId, scriptNode.id, 'loads');
        }

        primaryNodeId = reqNode.id;
        break;
      }

      case 'function-trace': {
        const funcNode = this.graph.addNode('function', op.target, {
          functionName: op.target,
          sessionId: op.sessionId,
          operationId: op.id,
          traceMode: true,
        });

        // script → function (contains)
        const scriptId = this.getString(op.config.scriptId);
        if (scriptId) {
          const scriptNode = this.graph.addNode('script', `script:${scriptId}`, {
            scriptId,
            sessionId: op.sessionId,
            operationId: op.id,
          });
          this.graph.addEdge(scriptNode.id, funcNode.id, 'contains');
        }

        primaryNodeId = funcNode.id;
        break;
      }

      case 'before-load-inject': {
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
   * If the artifact represents a live replay, also creates a replay-artifact node.
   */
  onArtifact(artifact: InstrumentationArtifact): void {
    const operationNodeId = this.operationNodeMap.get(artifact.operationId);

    const dataNode = this.graph.addNode('captured-data', `data:${artifact.operationId}`, {
      sessionId: artifact.sessionId,
      operationId: artifact.operationId,
      artifactType: artifact.type,
      ...artifact.data,
    });

    // Link operation node → captured-data (captures)
    if (operationNodeId) {
      this.graph.addEdge(operationNodeId, dataNode.id, 'captures');
    }

    // captured-data → replay-artifact (replays)
    if (artifact.data.replayMode === 'live') {
      const replayNode = this.graph.addNode('replay-artifact', `replay:${artifact.operationId}`, {
        sessionId: artifact.sessionId,
        operationId: artifact.operationId,
        artifactType: artifact.type,
        replayMode: artifact.data.replayMode,
        requestId: artifact.data.requestId,
        url: artifact.data.url,
        method: artifact.data.method,
        statusCode: artifact.data.statusCode,
      });
      this.graph.addEdge(dataNode.id, replayNode.id, 'replays');
    }
  }
}
