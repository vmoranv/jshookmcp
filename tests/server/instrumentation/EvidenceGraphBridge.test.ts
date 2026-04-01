/**
 * Tests for EvidenceGraphBridge — verifies all 6 evidence edge types
 * and the linkRequestToInitiator public API.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceGraphBridge } from '@server/instrumentation/EvidenceGraphBridge';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type {
  InstrumentationOperation,
  InstrumentationArtifact,
} from '@server/instrumentation/types';

describe('EvidenceGraphBridge', () => {
  let graph: ReverseEvidenceGraph;
  let bridge: EvidenceGraphBridge;

  beforeEach(() => {
    graph = new ReverseEvidenceGraph();
    bridge = new EvidenceGraphBridge(graph);
  });

  // ── runtime-hook operations ──────────────────────────────────────

  describe('runtime-hook operations', () => {
    it('creates function → breakpoint-hook (triggers) edge', () => {
      const op: InstrumentationOperation = {
        id: 'op1',
        sessionId: 'sess1',
        type: 'runtime-hook',
        target: 'signFunction',
        config: {},
        registeredAt: new Date().toISOString(),
      };

      const nodeId = bridge.onOperation(op);
      expect(nodeId).toBeTruthy();
      expect(graph.nodeCount).toBeGreaterThanOrEqual(2);
      expect(graph.edgeCount).toBeGreaterThanOrEqual(1);

      const exported = graph.exportJson();
      const edges = exported.edges.filter((e) => e.type === 'triggers');
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });

    it('creates script → function (contains) edge when scriptId is present', () => {
      const op: InstrumentationOperation = {
        id: 'op2',
        sessionId: 'sess1',
        type: 'runtime-hook',
        target: 'encryptData',
        config: { scriptId: 'script-42' },
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);
      const exported = graph.exportJson();
      const containsEdges = exported.edges.filter((e) => e.type === 'contains');
      expect(containsEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('does not create contains edge when scriptId is missing', () => {
      const op: InstrumentationOperation = {
        id: 'op3',
        sessionId: 'sess1',
        type: 'runtime-hook',
        target: 'noScript',
        config: {},
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);
      const exported = graph.exportJson();
      const containsEdges = exported.edges.filter((e) => e.type === 'contains');
      expect(containsEdges.length).toBe(0);
    });
  });

  // ── network-intercept operations ─────────────────────────────────

  describe('network-intercept operations', () => {
    it('creates request → initiator-stack (initiates) edge when initiator is a string', () => {
      const op: InstrumentationOperation = {
        id: 'op4',
        sessionId: 'sess1',
        type: 'network-intercept',
        target: 'https://api.example.com/login',
        config: { initiator: 'fetchWrapper' },
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);
      const exported = graph.exportJson();
      const initiatesEdges = exported.edges.filter((e) => e.type === 'initiates');
      expect(initiatesEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('creates request → initiator-stack (initiates) when initiator is object with stack', () => {
      const op: InstrumentationOperation = {
        id: 'op5',
        sessionId: 'sess1',
        type: 'network-intercept',
        target: 'https://api.example.com/data',
        config: { initiator: { stack: 'at fetchWrapper (app.js:42)' } },
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);
      const exported = graph.exportJson();
      const initiatesEdges = exported.edges.filter((e) => e.type === 'initiates');
      expect(initiatesEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('creates initiator-stack → script (loads) edge when initiatorScriptId is present', () => {
      const op: InstrumentationOperation = {
        id: 'op6',
        sessionId: 'sess1',
        type: 'network-intercept',
        target: 'https://api.example.com/sign',
        config: { initiator: 'fetchCall', initiatorScriptId: 'script-99' },
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);
      const exported = graph.exportJson();
      const loadsEdges = exported.edges.filter((e) => e.type === 'loads');
      expect(loadsEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('does not create initiates edge without initiator info', () => {
      const op: InstrumentationOperation = {
        id: 'op7',
        sessionId: 'sess1',
        type: 'network-intercept',
        target: 'https://cdn.example.com/lib.js',
        config: {},
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);
      const exported = graph.exportJson();
      const initiatesEdges = exported.edges.filter((e) => e.type === 'initiates');
      expect(initiatesEdges.length).toBe(0);
    });
  });

  // ── function-trace operations ────────────────────────────────────

  describe('function-trace operations', () => {
    it('creates function node and script → function (contains) edge', () => {
      const op: InstrumentationOperation = {
        id: 'op8',
        sessionId: 'sess1',
        type: 'function-trace',
        target: 'calculateHMAC',
        config: { scriptId: 'script-7' },
        registeredAt: new Date().toISOString(),
      };

      const nodeId = bridge.onOperation(op);
      expect(nodeId).toBeTruthy();
      const exported = graph.exportJson();
      const containsEdges = exported.edges.filter((e) => e.type === 'contains');
      expect(containsEdges.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── before-load-inject operations ────────────────────────────────

  describe('before-load-inject operations', () => {
    it('creates script node for injected script', () => {
      const op: InstrumentationOperation = {
        id: 'op9',
        sessionId: 'sess1',
        type: 'before-load-inject',
        target: 'hookXHR.js',
        config: {},
        registeredAt: new Date().toISOString(),
      };

      const nodeId = bridge.onOperation(op);
      expect(nodeId).toBeTruthy();
      const exported = graph.exportJson();
      const scriptNodes = exported.nodes.filter((n) => n.type === 'script');
      expect(scriptNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── artifact capture (captures + replays edges) ──────────────────

  describe('onArtifact', () => {
    it('creates captured-data and links via captures edge', () => {
      const op: InstrumentationOperation = {
        id: 'op10',
        sessionId: 'sess1',
        type: 'runtime-hook',
        target: 'signRequest',
        config: {},
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);

      const artifact: InstrumentationArtifact = {
        sessionId: 'sess1',
        operationId: 'op10',
        type: 'captured-args',
        data: { args: ['param1', 'param2'] },
        capturedAt: new Date().toISOString(),
      };

      bridge.onArtifact(artifact);

      const exported = graph.exportJson();
      const capturesEdges = exported.edges.filter((e) => e.type === 'captures');
      expect(capturesEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('creates replay-artifact node and replays edge when replayMode is live', () => {
      const op: InstrumentationOperation = {
        id: 'op11',
        sessionId: 'sess1',
        type: 'network-intercept',
        target: 'https://api.example.com/data',
        config: {},
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);

      const artifact: InstrumentationArtifact = {
        sessionId: 'sess1',
        operationId: 'op11',
        type: 'response-capture',
        data: {
          replayMode: 'live',
          requestId: 'req-42',
          url: 'https://api.example.com/data',
          method: 'GET',
          statusCode: 200,
        },
        capturedAt: new Date().toISOString(),
      };

      bridge.onArtifact(artifact);

      const exported = graph.exportJson();
      const replaysEdges = exported.edges.filter((e) => e.type === 'replays');
      expect(replaysEdges.length).toBeGreaterThanOrEqual(1);
      const replayNodes = exported.nodes.filter((n) => n.type === 'replay-artifact');
      expect(replayNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('does not create replays edge when replayMode is not live', () => {
      const op: InstrumentationOperation = {
        id: 'op12',
        sessionId: 'sess1',
        type: 'runtime-hook',
        target: 'decrypt',
        config: {},
        registeredAt: new Date().toISOString(),
      };

      bridge.onOperation(op);

      const artifact: InstrumentationArtifact = {
        sessionId: 'sess1',
        operationId: 'op12',
        type: 'captured-return',
        data: { returnValue: 'decrypted' },
        capturedAt: new Date().toISOString(),
      };

      bridge.onArtifact(artifact);

      const exported = graph.exportJson();
      const replaysEdges = exported.edges.filter((e) => e.type === 'replays');
      expect(replaysEdges.length).toBe(0);
    });

    it('handles artifact for unknown operationId gracefully', () => {
      const artifact: InstrumentationArtifact = {
        sessionId: 'sess1',
        operationId: 'unknown-op',
        type: 'captured-data',
        data: { value: 'test' },
        capturedAt: new Date().toISOString(),
      };

      // Should not throw
      bridge.onArtifact(artifact);

      const exported = graph.exportJson();
      const capturedNodes = exported.nodes.filter((n) => n.type === 'captured-data');
      expect(capturedNodes.length).toBeGreaterThanOrEqual(1);
      // No captures edge since operation was unknown
      const capturesEdges = exported.edges.filter((e) => e.type === 'captures');
      expect(capturesEdges.length).toBe(0);
    });
  });

  // ── linkRequestToInitiator public API ────────────────────────────

  describe('linkRequestToInitiator', () => {
    it('creates an initiates edge between two node IDs', () => {
      const reqNode = graph.addNode('request', 'https://api.example.com', {});
      const initNode = graph.addNode('initiator-stack', 'fetchWrapper:42', {});

      bridge.linkRequestToInitiator(reqNode.id, initNode.id);

      const exported = graph.exportJson();
      const initiatesEdges = exported.edges.filter((e) => e.type === 'initiates');
      expect(initiatesEdges.length).toBe(1);
      expect(initiatesEdges[0]!.source).toBe(reqNode.id);
      expect(initiatesEdges[0]!.target).toBe(initNode.id);
    });
  });

  // ── full chain integration test ──────────────────────────────────

  describe('full evidence chain', () => {
    it('builds request → initiator → script → function → hook → data → replay chain', () => {
      // 1. Network intercept with initiator
      bridge.onOperation({
        id: 'chain-net',
        sessionId: 'sess-chain',
        type: 'network-intercept',
        target: 'https://api.example.com/sign',
        config: { initiator: 'signModule', initiatorScriptId: 'script-main' },
        registeredAt: new Date().toISOString(),
      });

      // 2. Runtime hook
      bridge.onOperation({
        id: 'chain-hook',
        sessionId: 'sess-chain',
        type: 'runtime-hook',
        target: 'generateSignature',
        config: { scriptId: 'script-main' },
        registeredAt: new Date().toISOString(),
      });

      // 3. Artifact capture
      bridge.onArtifact({
        sessionId: 'sess-chain',
        operationId: 'chain-hook',
        type: 'captured-args',
        data: { args: ['timestamp', 'nonce'] },
        capturedAt: new Date().toISOString(),
      });

      // 4. Replay artifact
      bridge.onArtifact({
        sessionId: 'sess-chain',
        operationId: 'chain-net',
        type: 'response-replay',
        data: {
          replayMode: 'live',
          requestId: 'req-sign',
          url: 'https://api.example.com/sign',
          method: 'POST',
          statusCode: 200,
        },
        capturedAt: new Date().toISOString(),
      });

      const exported = graph.exportJson();

      // Verify all 6 edge types exist
      const edgeTypes = new Set(exported.edges.map((e) => e.type));
      expect(edgeTypes.has('initiates')).toBe(true);
      expect(edgeTypes.has('loads')).toBe(true);
      expect(edgeTypes.has('contains')).toBe(true);
      expect(edgeTypes.has('triggers')).toBe(true);
      expect(edgeTypes.has('captures')).toBe(true);
      expect(edgeTypes.has('replays')).toBe(true);

      // Verify node types
      const nodeTypes = new Set(exported.nodes.map((n) => n.type));
      expect(nodeTypes.has('request')).toBe(true);
      expect(nodeTypes.has('initiator-stack')).toBe(true);
      expect(nodeTypes.has('script')).toBe(true);
      expect(nodeTypes.has('function')).toBe(true);
      expect(nodeTypes.has('breakpoint-hook')).toBe(true);
      expect(nodeTypes.has('captured-data')).toBe(true);
      expect(nodeTypes.has('replay-artifact')).toBe(true);
    });
  });
});
