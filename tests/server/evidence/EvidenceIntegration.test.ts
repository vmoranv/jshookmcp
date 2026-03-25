import { beforeEach, describe, expect, it } from 'vitest';
import { ReverseEvidenceGraph, _resetIdCounter } from '@server/evidence/ReverseEvidenceGraph';
import { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { EvidenceGraphBridge } from '@server/instrumentation/EvidenceGraphBridge';
import { InstrumentationType } from '@server/instrumentation/types';

describe('EVID-04: InstrumentationSession → Evidence Graph Integration', () => {
  let graph: ReverseEvidenceGraph;
  let sessionMgr: InstrumentationSessionManager;
  let bridge: EvidenceGraphBridge;

  beforeEach(() => {
    _resetIdCounter();
    graph = new ReverseEvidenceGraph();
    sessionMgr = new InstrumentationSessionManager();
    bridge = new EvidenceGraphBridge(graph);
    sessionMgr.setEvidenceBridge(bridge);
  });

  it('registerOperation(runtime-hook) creates function + breakpoint-hook nodes', () => {
    const session = sessionMgr.createSession('test');
    sessionMgr.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'decrypt', {});

    const nodes = graph.exportJson().nodes;
    const funcNode = nodes.find((n) => n.type === 'function');
    const hookNode = nodes.find((n) => n.type === 'breakpoint-hook');

    expect(funcNode).toBeDefined();
    expect(funcNode!.label).toBe('decrypt');
    expect(funcNode!.metadata.functionName).toBe('decrypt');

    expect(hookNode).toBeDefined();
    expect(hookNode!.label).toBe('hook:decrypt');

    // Edge: function → breakpoint-hook
    const edges = graph.exportJson().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('triggers');
  });

  it('registerOperation(network-intercept) creates request node with URL metadata', () => {
    const session = sessionMgr.createSession('test');
    sessionMgr.registerOperation(
      session.id,
      InstrumentationType.NETWORK_INTERCEPT,
      'https://api.example.com/auth',
      { method: 'POST' },
    );

    const nodes = graph.exportJson().nodes;
    const reqNode = nodes.find((n) => n.type === 'request');
    expect(reqNode).toBeDefined();
    expect(reqNode!.metadata.url).toBe('https://api.example.com/auth');
  });

  it('registerOperation(function-trace) creates function node with name metadata', () => {
    const session = sessionMgr.createSession('test');
    sessionMgr.registerOperation(
      session.id,
      InstrumentationType.FUNCTION_TRACE,
      'processPayload',
      {},
    );

    const nodes = graph.exportJson().nodes;
    const funcNode = nodes.find((n) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.metadata.functionName).toBe('processPayload');
    expect(funcNode!.metadata.traceMode).toBe(true);
  });

  it('registerOperation(before-load-inject) creates script node', () => {
    const session = sessionMgr.createSession('test');
    sessionMgr.registerOperation(
      session.id,
      InstrumentationType.BEFORE_LOAD_INJECT,
      'hook-script.js',
      {},
    );

    const nodes = graph.exportJson().nodes;
    const scriptNode = nodes.find((n) => n.type === 'script');
    expect(scriptNode).toBeDefined();
    expect(scriptNode!.label).toBe('hook-script.js');
    expect(scriptNode!.metadata.injectionPoint).toBe('before-load');
  });

  it('recordArtifact creates captured-data node linked to operation node', () => {
    const session = sessionMgr.createSession('test');
    const op = sessionMgr.registerOperation(
      session.id,
      InstrumentationType.RUNTIME_HOOK,
      'getToken',
      {},
    );

    sessionMgr.recordArtifact(op.id, {
      args: ['user123'],
      returnValue: 'jwt-token-abc',
    });

    const nodes = graph.exportJson().nodes;
    const dataNode = nodes.find((n) => n.type === 'captured-data');
    expect(dataNode).toBeDefined();
    expect(dataNode!.metadata.args).toEqual(['user123']);
    expect(dataNode!.metadata.returnValue).toBe('jwt-token-abc');

    // Edge: breakpoint-hook → captured-data
    const edges = graph.exportJson().edges;
    const captureEdge = edges.find((e) => e.type === 'captures');
    expect(captureEdge).toBeDefined();
  });

  it('graph maintains provenance chain from operation to artifact', () => {
    const session = sessionMgr.createSession('test');
    const op = sessionMgr.registerOperation(
      session.id,
      InstrumentationType.RUNTIME_HOOK,
      'encrypt',
      {},
    );
    sessionMgr.recordArtifact(op.id, { args: ['plaintext'], returnValue: 'ciphertext' });

    // Should have: function → breakpoint-hook → captured-data
    const funcNode = graph.exportJson().nodes.find((n) => n.type === 'function')!;
    const chain = graph.getEvidenceChain(funcNode.id, 'forward');
    expect(chain).toHaveLength(3);
    expect(chain.map((n) => n.type)).toEqual(['function', 'breakpoint-hook', 'captured-data']);
  });

  it('no bridge set → operations work normally without errors', () => {
    const mgr = new InstrumentationSessionManager();
    // Don't set bridge
    const session = mgr.createSession('standalone');
    const op = mgr.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'test', {});
    mgr.recordArtifact(op.id, { returnValue: 42 });

    expect(graph.nodeCount).toBe(0); // Graph untouched
    expect(mgr.getArtifacts(session.id)).toHaveLength(1); // Artifacts still recorded
  });
});
