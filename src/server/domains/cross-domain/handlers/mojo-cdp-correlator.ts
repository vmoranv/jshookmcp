import type { CrossDomainEvidenceBridge } from './evidence-graph-bridge';

export interface MojoMessage {
  interface: string;
  method: string;
  timestamp: number;
  messageId: string;
}

export interface CDPEvent {
  eventType: string;
  timestamp: number;
  url?: string;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  timestamp: number;
}

export interface MatchedPair {
  mojoMessageId: string;
  matchType: 'interface' | 'urlloader' | 'timestamp';
  cdpEventType?: string;
  networkRequestId?: string;
  timestampDelta?: number;
}

export interface MojoCDPCorrelationResult {
  mojoMessages: number;
  matchedPairs: MatchedPair[];
  unmatchedMojo: string[];
  confidence: number;
  graphNodeIds: string[];
}

/** Mapping of Mojo interface patterns to CDP event patterns. */
const INTERFACE_TO_CDP_PATTERNS: Array<{ mojoPattern: RegExp; cdpPattern: RegExp }> = [
  { mojoPattern: /URLLoader/i, cdpPattern: /Network\./i },
  { mojoPattern: /WebSocket/i, cdpPattern: /Network\.webSocket/i },
  { mojoPattern: /Fetch/i, cdpPattern: /Fetch\./i },
];

const TIMESTAMP_PROXIMITY_MS = 50;

export function correlateMojoToCDP(
  bridge: CrossDomainEvidenceBridge,
  mojoMessages: MojoMessage[],
  cdpEvents: CDPEvent[],
  networkRequests: NetworkRequest[],
): MojoCDPCorrelationResult {
  const graphNodeIds: string[] = [];
  const matchedPairs: MatchedPair[] = [];
  const matchedMojoIds = new Set<string>();

  if (mojoMessages.length === 0) {
    return {
      mojoMessages: 0,
      matchedPairs: [],
      unmatchedMojo: [],
      confidence: 0,
      graphNodeIds: [],
    };
  }

  // Add all Mojo messages to the graph
  const mojoNodeMap = new Map<string, string>();
  for (const msg of mojoMessages) {
    const node = bridge.addMojoMessage({
      interface: msg.interface,
      method: msg.method,
      timestamp: msg.timestamp,
    });
    mojoNodeMap.set(msg.messageId, node.id);
    graphNodeIds.push(node.id);
  }

  // Pass 1: Match by interface name pattern → CDP event
  for (const msg of mojoMessages) {
    if (matchedMojoIds.has(msg.messageId)) {
      continue;
    }

    for (const pattern of INTERFACE_TO_CDP_PATTERNS) {
      if (!pattern.mojoPattern.test(msg.interface)) {
        continue;
      }

      const matchingCdp = cdpEvents.find(
        (evt) => pattern.cdpPattern.test(evt.eventType) && !matchedMojoIds.has(msg.messageId),
      );
      if (matchingCdp) {
        matchedPairs.push({
          mojoMessageId: msg.messageId,
          matchType: 'interface',
          cdpEventType: matchingCdp.eventType,
        });
        matchedMojoIds.add(msg.messageId);
        break;
      }
    }
  }

  // Pass 2: Match URLLoader Mojo messages → network requests by timestamp
  for (const msg of mojoMessages) {
    if (matchedMojoIds.has(msg.messageId)) {
      continue;
    }

    if (/URLLoader/i.test(msg.interface)) {
      const matchingReq = networkRequests.find(
        (req) => Math.abs(req.timestamp - msg.timestamp) <= TIMESTAMP_PROXIMITY_MS,
      );
      if (matchingReq) {
        matchedPairs.push({
          mojoMessageId: msg.messageId,
          matchType: 'urlloader',
          networkRequestId: matchingReq.requestId,
          timestampDelta: Math.abs(matchingReq.timestamp - msg.timestamp),
        });
        matchedMojoIds.add(msg.messageId);
      }
    }
  }

  // Pass 3: Fallback timestamp proximity match for remaining unmatched
  for (const msg of mojoMessages) {
    if (matchedMojoIds.has(msg.messageId)) {
      continue;
    }

    // Check CDP events by timestamp
    let closestDelta = Infinity;
    let closestCdp: CDPEvent | undefined;
    for (const evt of cdpEvents) {
      const delta = Math.abs(evt.timestamp - msg.timestamp);
      if (delta <= TIMESTAMP_PROXIMITY_MS && delta < closestDelta) {
        closestDelta = delta;
        closestCdp = evt;
      }
    }

    if (closestCdp) {
      matchedPairs.push({
        mojoMessageId: msg.messageId,
        matchType: 'timestamp',
        cdpEventType: closestCdp.eventType,
        timestampDelta: closestDelta,
      });
      matchedMojoIds.add(msg.messageId);
    }
  }

  const unmatchedMojo = mojoMessages
    .filter((msg) => !matchedMojoIds.has(msg.messageId))
    .map((msg) => msg.messageId);

  const confidence = mojoMessages.length === 0 ? 0 : matchedMojoIds.size / mojoMessages.length;

  return {
    mojoMessages: mojoMessages.length,
    matchedPairs,
    unmatchedMojo,
    confidence,
    graphNodeIds,
  };
}
