import { ReverseEvidenceGraph, resetIdCounter } from '@server/evidence/ReverseEvidenceGraph';
import type { EvidenceGraphSnapshot, EvidenceNode, EvidenceNodeType } from '@server/evidence/types';

export { resetIdCounter };

export interface V8ObjectInput {
  address: string;
  name: string;
}

export interface NetworkRequestInput {
  requestId?: string;
  url: string;
  method?: string;
}

export interface CanvasNodeInput {
  nodeId: string;
  label: string;
}

export interface SyscallEventInput {
  pid: number;
  tid: number;
  syscallName: string;
  timestamp: number;
}

export interface MojoMessageInput {
  interface: string;
  method: string;
  timestamp: number;
}

export interface BinarySymbolInput {
  moduleName: string;
  symbolName: string;
  address: string;
}

export class CrossDomainEvidenceBridge {
  private readonly graph: ReverseEvidenceGraph;

  constructor(graph: ReverseEvidenceGraph) {
    this.graph = graph;
  }

  getGraph(): ReverseEvidenceGraph {
    return this.graph;
  }

  addNode(type: EvidenceNodeType, label: string, metadata: Record<string, unknown>): EvidenceNode {
    return this.graph.addNode(type, label, metadata);
  }

  addV8Object(input: V8ObjectInput, scriptNodeId?: string): EvidenceNode {
    const node = this.graph.addNode('v8-heap-object', input.name, {
      domain: 'v8-inspector',
      address: input.address,
      name: input.name,
    });
    if (scriptNodeId) {
      this.graph.addEdge(scriptNodeId, node.id, 'heap-allocates', {
        domain: 'cross-domain',
        relation: 'script-allocates-heap-object',
      });
    }
    return node;
  }

  addNetworkRequest(
    input: NetworkRequestInput,
    initiatorHeapNodeId?: string,
  ): { node: EvidenceNode; initiatorNode?: EvidenceNode } {
    const label = input.method ? `${input.method} ${input.url}` : input.url;
    const node = this.graph.addNode('network-request', label, {
      domain: 'network',
      requestId: input.requestId,
      url: input.url,
      method: input.method ?? 'GET',
    });
    let initiatorNode: EvidenceNode | undefined;
    if (initiatorHeapNodeId) {
      initiatorNode = this.graph.getNode(initiatorHeapNodeId);
      this.graph.addEdge(initiatorHeapNodeId, node.id, 'network-initiated-by', {
        domain: 'cross-domain',
        relation: 'heap-initiates-network',
      });
    }
    return { node, initiatorNode };
  }

  addCanvasNode(input: CanvasNodeInput, creatorHeapNodeId?: string): EvidenceNode {
    const node = this.graph.addNode('canvas-scene-node', input.label, {
      domain: 'canvas',
      nodeId: input.nodeId,
      label: input.label,
    });
    if (creatorHeapNodeId) {
      this.graph.addEdge(creatorHeapNodeId, node.id, 'canvas-rendered-by', {
        domain: 'cross-domain',
        relation: 'heap-creates-canvas-node',
      });
    }
    return node;
  }

  addSyscallEvent(input: SyscallEventInput, jsFunctionNodeId?: string): EvidenceNode {
    const node = this.graph.addNode('syscall-event', input.syscallName, {
      domain: 'syscall-hook',
      pid: input.pid,
      tid: input.tid,
      syscallName: input.syscallName,
      timestamp: input.timestamp,
    });
    if (jsFunctionNodeId) {
      this.graph.addEdge(jsFunctionNodeId, node.id, 'syscall-emitted-by', {
        domain: 'cross-domain',
        relation: 'js-triggers-syscall',
      });
    }
    return node;
  }

  addMojoMessage(input: MojoMessageInput, cdpEventNodeId?: string): EvidenceNode {
    const node = this.graph.addNode('mojo-message', `${input.interface}:${input.method}`, {
      domain: 'mojo-ipc',
      interface: input.interface,
      method: input.method,
      timestamp: input.timestamp,
    });
    if (cdpEventNodeId) {
      this.graph.addEdge(cdpEventNodeId, node.id, 'mojo-routed-to', {
        domain: 'cross-domain',
        relation: 'cdp-routes-to-mojo',
      });
    }
    return node;
  }

  addBinarySymbol(input: BinarySymbolInput, jsFunctionNodeId?: string): EvidenceNode {
    const node = this.graph.addNode('binary-symbol', input.symbolName, {
      domain: 'binary-instrument',
      moduleName: input.moduleName,
      symbolName: input.symbolName,
      address: input.address,
    });
    if (jsFunctionNodeId) {
      this.graph.addEdge(jsFunctionNodeId, node.id, 'binary-exports', {
        domain: 'cross-domain',
        relation: 'js-references-native-symbol',
      });
    }
    return node;
  }

  queryByHeapAddress(addr: string): EvidenceNode[] {
    const snapshot = this.graph.exportJson();
    const matchingIds: string[] = [];
    for (const node of snapshot.nodes) {
      const address = node.metadata['address'];
      if (typeof address === 'string' && address.includes(addr)) {
        matchingIds.push(node.id);
      }
    }
    return this.collectConnectedNodes(matchingIds);
  }

  queryByNetworkUrl(url: string): EvidenceNode[] {
    return this.graph.queryByUrl(url);
  }

  exportGraph(): EvidenceGraphSnapshot {
    return this.graph.exportJson();
  }

  getStats(): {
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<string, number>;
  } {
    const snapshot = this.graph.exportJson();
    const nodesByType: Record<string, number> = {};
    for (const node of snapshot.nodes) {
      const currentCount = nodesByType[node.type] ?? 0;
      nodesByType[node.type] = currentCount + 1;
    }

    return {
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      nodesByType,
    };
  }

  private collectConnectedNodes(nodeIds: string[]): EvidenceNode[] {
    const collected = new Map<string, EvidenceNode>();
    for (const nodeId of nodeIds) {
      for (const node of this.graph.getEvidenceChain(nodeId, 'forward')) {
        collected.set(node.id, node);
      }
      for (const node of this.graph.getEvidenceChain(nodeId, 'backward')) {
        collected.set(node.id, node);
      }
    }
    return [...collected.values()];
  }
}
