import { describe, expect, it, beforeEach } from 'vitest';
import {
  CrossDomainEvidenceBridge,
  _resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';

describe('CrossDomainEvidenceBridge', () => {
  let bridge: CrossDomainEvidenceBridge;

  beforeEach(() => {
    _resetIdCounter();
    bridge = new CrossDomainEvidenceBridge();
  });

  describe('addV8Object', () => {
    it('should add a V8 heap object node to the graph', () => {
      const node = bridge.addV8Object({ address: '0x1234', name: 'TestObject' });
      expect(node.id).toMatch(/^v8-heap-object-/);
      expect(node.type).toBe('v8-heap-object');
      expect(node.label).toBe('TestObject');
      expect(node.metadata.address).toBe('0x1234');
    });

    it('should link V8 object to a script node when scriptNodeId provided', () => {
      const scriptNode = bridge.addNode('script', 'bundle.js', {});
      const v8Node = bridge.addV8Object({ address: '0x5678', name: 'GameScene' }, scriptNode.id);
      const edges = bridge.getGraph().getEdgesFrom(scriptNode.id);
      expect(edges).toHaveLength(1);
      // @ts-expect-error
      expect(edges[0].type).toBe('heap-allocates');
      // @ts-expect-error
      expect(edges[0].target).toBe(v8Node.id);
    });
  });

  describe('addNetworkRequest', () => {
    it('should add a network request node', () => {
      const { node } = bridge.addNetworkRequest({ url: 'https://api.example.com/data' });
      expect(node.id).toMatch(/^network-request-/);
      expect(node.type).toBe('network-request');
      expect(node.metadata.url).toBe('https://api.example.com/data');
    });

    it('should link network request to initiator heap node', () => {
      const heapNode = bridge.addV8Object({ address: '0x9999', name: 'FetchWrapper' });
      const { node: netNode } = bridge.addNetworkRequest(
        { url: 'https://api.example.com/secure', method: 'POST' },
        heapNode.id,
      );
      const edges = bridge.getGraph().getEdgesFrom(heapNode.id);
      expect(edges.some((e) => e.target === netNode.id && e.type === 'network-initiated-by')).toBe(
        true,
      );
    });
  });

  describe('addCanvasNode', () => {
    it('should add a canvas scene node', () => {
      const node = bridge.addCanvasNode({ nodeId: 'layer-1', label: 'Background' });
      expect(node.id).toMatch(/^canvas-scene-node-/);
      expect(node.type).toBe('canvas-scene-node');
      expect(node.label).toBe('Background');
      expect(node.metadata.nodeId).toBe('layer-1');
    });
  });

  describe('addSyscallEvent', () => {
    it('should add a syscall event node', () => {
      const node = bridge.addSyscallEvent({
        pid: 1234,
        tid: 5678,
        syscallName: 'NtReadFile',
        timestamp: Date.now(),
      });
      expect(node.id).toMatch(/^syscall-event-/);
      expect(node.type).toBe('syscall-event');
      expect(node.label).toBe('NtReadFile');
      expect(node.metadata.pid).toBe(1234);
    });
  });

  describe('addMojoMessage', () => {
    it('should add a mojo message node', () => {
      const node = bridge.addMojoMessage({
        interface: 'MojomURLLoader',
        method: 'OnResponseReceived',
        timestamp: Date.now(),
      });
      expect(node.id).toMatch(/^mojo-message-/);
      expect(node.type).toBe('mojo-message');
      expect(node.label).toBe('MojomURLLoader:OnResponseReceived');
    });
  });

  describe('addBinarySymbol', () => {
    it('should add a binary symbol node', () => {
      const node = bridge.addBinarySymbol({
        moduleName: 'libnative.so',
        symbolName: 'native_encrypt',
        address: '0x7fff0000',
      });
      expect(node.id).toMatch(/^binary-symbol-/);
      expect(node.type).toBe('binary-symbol');
      expect(node.metadata.moduleName).toBe('libnative.so');
      expect(node.metadata.symbolName).toBe('native_encrypt');
    });
  });

  describe('queryByNetworkUrl', () => {
    it('should find network nodes by URL', () => {
      bridge.addNetworkRequest({ url: 'https://secret.game/api/check' });
      bridge.addNetworkRequest({ url: 'https://other.example.com' });
      const results = bridge.queryByNetworkUrl('secret.game');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((n) => n.type === 'network-request')).toBe(true);
    });
  });

  describe('exportGraph', () => {
    it('should export a valid graph snapshot', () => {
      bridge.addV8Object({ address: '0x1000', name: 'Obj1' });
      bridge.addNetworkRequest({ url: 'https://example.com' });
      const snapshot = bridge.exportGraph();
      expect(snapshot.version).toBe(1);
      expect(snapshot.nodes.length).toBeGreaterThanOrEqual(2);
      expect(snapshot.edges.length).toBeGreaterThanOrEqual(0);
      expect(snapshot.exportedAt).toBeTruthy();
    });
  });

  describe('getStats', () => {
    it('should return correct node/edge counts', () => {
      bridge.addV8Object({ address: '0x1', name: 'A' });
      bridge.addV8Object({ address: '0x2', name: 'B' });
      const stats = bridge.getStats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.nodesByType['v8-heap-object']).toBe(2);
    });
  });
});
