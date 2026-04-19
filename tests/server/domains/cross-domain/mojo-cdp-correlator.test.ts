import { describe, expect, it, beforeEach } from 'vitest';
import { correlateMojoToCDP } from '@server/domains/cross-domain/handlers/mojo-cdp-correlator';
import {
  CrossDomainEvidenceBridge,
  _resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';
import {
  ReverseEvidenceGraph,
  _resetIdCounter as _resetGraphIdCounter,
} from '@server/evidence/ReverseEvidenceGraph';

describe('MOJO-03: Mojo-to-CDP Correlator', () => {
  let bridge: CrossDomainEvidenceBridge;

  beforeEach(() => {
    _resetIdCounter();
    _resetGraphIdCounter();
    bridge = new CrossDomainEvidenceBridge(new ReverseEvidenceGraph());
  });

  it('should add mojo message nodes to the graph', () => {
    const result = correlateMojoToCDP(
      bridge,
      [
        {
          interface: 'MojomURLLoader',
          method: 'OnResponseReceived',
          timestamp: 1000,
          messageId: 'msg-1',
        },
      ],
      [],
      [],
    );

    expect(result.mojoMessages).toBe(1);
    expect(result.graphNodeIds.length).toBe(1);
  });

  it('should match Mojo to CDP by interface name pattern', () => {
    const mojoMessages = [
      {
        interface: 'MojomURLLoader',
        method: 'OnResponseReceived',
        timestamp: 1000,
        messageId: 'msg-1',
      },
    ];
    const cdpEvents = [
      {
        eventType: 'Network.requestWillBeSent',
        timestamp: 1000,
        url: 'https://example.com/api',
      },
    ];

    const result = correlateMojoToCDP(bridge, mojoMessages, cdpEvents, []);

    expect(result.matchedPairs.length).toBeGreaterThanOrEqual(1);
    expect(result.matchedPairs[0]?.matchType).toBe('interface');
  });

  it('should match Mojo to Network by URLLoader pattern', () => {
    const mojoMessages = [
      {
        interface: 'MojomURLLoader',
        method: 'Start',
        timestamp: 500,
        messageId: 'msg-2',
      },
    ];
    const networkRequests = [
      { requestId: 'req-1', url: 'https://api.game.com/v1/check', timestamp: 500 },
    ];

    const result = correlateMojoToCDP(bridge, mojoMessages, [], networkRequests);

    expect(result.matchedPairs.some((p) => p.matchType === 'urlloader')).toBe(true);
  });

  it('should match by timestamp proximity when interface pattern does not apply', () => {
    // Use non-matching interface + close timestamps to ensure Pass 3 (timestamp) fires
    const mojoMessages = [
      { interface: 'MojomCustom', method: 'CustomEvent', timestamp: 50000, messageId: 'msg-ts' },
    ];
    const cdpEvents = [
      { eventType: 'SomeOtherEvent', timestamp: 50030 }, // within 50ms window
    ];

    const result = correlateMojoToCDP(bridge, mojoMessages, cdpEvents, []);

    // Should match by timestamp proximity (Pass 3), not interface
    expect(result.matchedPairs.some((p) => p.matchType === 'timestamp')).toBe(true);
    expect(result.matchedPairs.length).toBeGreaterThanOrEqual(1);
    const matchedPair = result.matchedPairs.find((p) => p.matchType === 'timestamp');
    expect(matchedPair?.timestampDelta).toBeLessThanOrEqual(50);
  });

  it('should report unmatched mojo messages', () => {
    const result = correlateMojoToCDP(
      bridge,
      [{ interface: 'MojomFoo', method: 'Bar', timestamp: 999, messageId: 'orphan' }],
      [],
      [],
    );

    expect(result.unmatchedMojo).toContain('orphan');
    expect(result.confidence).toBeLessThan(1);
  });

  it('should handle empty inputs gracefully', () => {
    const result = correlateMojoToCDP(bridge, [], [], []);

    expect(result.mojoMessages).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.matchedPairs).toHaveLength(0);
  });
});
