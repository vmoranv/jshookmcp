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
import type { EvidenceEdgeType } from '@server/evidence/types';
import type { InstrumentationOperation, InstrumentationArtifact } from './types';

export class EvidenceGraphBridge {
  private readonly graph: ReverseEvidenceGraph;
  /** Maps operationId → primary evidence node ID for edge linking. */
  private readonly operationNodeMap = new Map<string, string>();
  /** Maps operationId → request node ID for manual linking / replay chaining. */
  private readonly requestNodeMap = new Map<string, string>();

  /** Independent cap on bridge-side maps to prevent unbounded growth. */
  private static readonly MAX_MAP_ENTRIES = 10_000;

  constructor(graph: ReverseEvidenceGraph) {
    this.graph = graph;
  }

  // ── Helpers ─────────────────────────────────────────────

  /**
   * Add an edge only when both endpoints still exist in the graph.
   *
   * ReverseEvidenceGraph evicts its oldest nodes under a size cap, which can
   * retire a node the bridge already recorded. `addEdge` throws on a dangling
   * endpoint; skipping here degrades gracefully instead of crashing long-lived
   * sessions — the evidence edge is lost together with the evicted node anyway.
   */
  private linkSafe(sourceId: string, targetId: string, type: EvidenceEdgeType): void {
    if (this.graph.getNode(sourceId) === undefined) return;
    if (this.graph.getNode(targetId) === undefined) return;
    this.graph.addEdge(sourceId, targetId, type);
  }

  /**
   * Insert into a bridge map, evicting the oldest entry once the cap is crossed.
   * Maps are keyed by operationId and preserve insertion order, so the oldest
   * entry is the map's first key.
   */
  private static setWithPrune(map: Map<string, string>, key: string, value: string): void {
    map.set(key, value);
    while (map.size > EvidenceGraphBridge.MAX_MAP_ENTRIES) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
    }
  }

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
    this.linkSafe(requestNodeId, initiatorStackNodeId, 'initiates');
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
          this.linkSafe(scriptNode.id, funcNode.id, 'contains');
        }

        // function → breakpoint-hook (triggers)
        const hookNode = this.graph.addNode('breakpoint-hook', `hook:${op.target}`, {
          hookType: 'runtime-hook',
          sessionId: op.sessionId,
          operationId: op.id,
          config: op.config,
        });
        this.linkSafe(funcNode.id, hookNode.id, 'triggers');
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
        EvidenceGraphBridge.setWithPrune(this.requestNodeMap, op.id, reqNode.id);

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
          this.linkSafe(initiatorNodeId, scriptNode.id, 'loads');
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
          this.linkSafe(scriptNode.id, funcNode.id, 'contains');
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
      EvidenceGraphBridge.setWithPrune(this.operationNodeMap, op.id, primaryNodeId);
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

    // Drop stale map entries whose backing node was evicted, so the link below
    // degrades to a skip instead of throwing on a dangling endpoint.
    if (operationNodeId !== undefined && this.graph.getNode(operationNodeId) === undefined) {
      this.operationNodeMap.delete(artifact.operationId);
    }

    // Payload first, provenance last: artifact data comes from handler payloads
    // and must never be able to overwrite the authoritative session/operation/type
    // fields that the evidence chain and exports rely on.
    const dataNode = this.graph.addNode('captured-data', `data:${artifact.operationId}`, {
      ...artifact.data,
      sessionId: artifact.sessionId,
      operationId: artifact.operationId,
      artifactType: artifact.type,
    });

    // Link operation node → captured-data (captures)
    if (operationNodeId) {
      this.linkSafe(operationNodeId, dataNode.id, 'captures');
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
      this.linkSafe(dataNode.id, replayNode.id, 'replays');
    }
  }
}
