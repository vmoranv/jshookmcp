import { describe, expect, it, beforeEach } from 'vitest';
import {
  CrossDomainEvidenceBridge,
  _resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';
import {
  ReverseEvidenceGraph,
  _resetIdCounter as _resetGraphIdCounter,
} from '@server/evidence/ReverseEvidenceGraph';
import { createServerEventBus } from '@server/EventBus';

describe('Shared Evidence Graph Integration', () => {
  beforeEach(() => {
    _resetIdCounter();
    _resetGraphIdCounter();
  });

  it('cross-domain bridge and evidence handlers share the same graph instance', async () => {
    const sharedGraph = new ReverseEvidenceGraph();
    const bridge = new CrossDomainEvidenceBridge(sharedGraph);

    // Write via cross-domain bridge
    bridge.addV8Object({ address: '0x1000', name: 'SharedObject' });

    // Read directly from shared graph
    expect(sharedGraph.nodeCount).toBe(1);
    const snapshot = sharedGraph.exportJson();
    expect(snapshot.nodes.some((n) => n.label === 'SharedObject')).toBe(true);
  });

  it('cross-domain mutations trigger evidence:updated event via shared graph commit', async () => {
    const eventBus = createServerEventBus();
    const sharedGraph = new ReverseEvidenceGraph();
    sharedGraph.setEventBus(eventBus);

    const bridge = new CrossDomainEvidenceBridge(sharedGraph);

    let eventFired = false;
    eventBus.on('evidence:updated', () => {
      eventFired = true;
    });

    // Write via cross-domain bridge
    bridge.addV8Object({ address: '0x2000', name: 'EventTest' });
    bridge.addNetworkRequest({ url: 'https://example.com' });

    // Commit triggers the event
    sharedGraph.commit();

    // Give async event time to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(eventFired).toBe(true);
  });

  it('evidence domain query sees cross-domain written nodes', async () => {
    const sharedGraph = new ReverseEvidenceGraph();
    const bridge = new CrossDomainEvidenceBridge(sharedGraph);

    bridge.addNetworkRequest({ url: 'https://secret.api/data' });
    bridge.addV8Object({ address: '0x3000', name: 'CryptoHelper' });

    // Evidence domain's queryByUrl should find the cross-domain node
    const results = sharedGraph.queryByUrl('secret.api');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((n) => n.type === 'network-request')).toBe(true);
  });

  it('no duplicate graph instances — bridge.getGraph() returns the injected graph', async () => {
    const sharedGraph = new ReverseEvidenceGraph();
    const bridge = new CrossDomainEvidenceBridge(sharedGraph);

    expect(bridge.getGraph()).toBe(sharedGraph);
  });
});
