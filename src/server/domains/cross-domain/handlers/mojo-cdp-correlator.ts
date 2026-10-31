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
  /** HTTP method (GET/POST/...). Optional — MOJO-03 ignores it. */
  method?: string;
  /** Request initiator provenance. Optional — consumed by the network→V8 correlator. */
  initiator?: NetworkInitiator;
}

/**
 * Describes what initiated a network request — mirrors the subset of the CDP
 * `Network.requestWillBeSent.initiator` payload that the network→V8 correlator
 * can reconcile against existing function / heap-object evidence nodes.
 */
export interface NetworkInitiator {
  /** JS function name that issued the request (CDP initiator.stack.callFrames[0].functionName). */
  functionName?: string;
  /** Heap object address (hex string) that owns the request, when known. */
  heapAddress?: string;
  /** Script URL or source that initiated the request. */
  url?: string;
  /** Call stack frame function names, innermost first. */
  stack?: string[];
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
  // Each CDP event / network request is consumed at most once across passes,
  // so a single event cannot be correlated to several mojo messages.
  const matchedCdpEvents = new Set<CDPEvent>();
  const matchedRequestIds = new Set<string>();
  const requestNodeIds = new Map<string, string>();

  for (const request of networkRequests) {
    const { node } = bridge.addNetworkRequest({
      requestId: request.requestId,
      url: request.url,
    });
    requestNodeIds.set(request.requestId, node.id);
    graphNodeIds.push(node.id);
  }

  if (mojoMessages.length === 0) {
    return {
      mojoMessages: 0,
      matchedPairs: [],
      unmatchedMojo: [],
      confidence: 0,
      graphNodeIds,
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

  const state: CorrelationState = {
    matchedPairs,
    matchedMojoIds,
    matchedCdpEvents,
    matchedRequestIds,
  };

  // Pass 1: Match by interface name pattern → CDP event
  matchByInterfacePattern(mojoMessages, cdpEvents, state);
  // Pass 2: Match URLLoader Mojo messages → network requests by timestamp
  matchUrlLoaderToRequests(
    mojoMessages,
    networkRequests,
    state,
    bridge,
    requestNodeIds,
    mojoNodeMap,
  );
  // Pass 3: Fallback timestamp proximity match for remaining unmatched
  matchByTimestampProximity(mojoMessages, cdpEvents, state);

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

/** Mutable match bookkeeping shared by the three correlation passes. */
interface CorrelationState {
  matchedPairs: MatchedPair[];
  matchedMojoIds: Set<string>;
  matchedCdpEvents: Set<CDPEvent>;
  matchedRequestIds: Set<string>;
}

/** Pass 1: interface-name pattern → unconsumed CDP event of a matching type. */
function matchByInterfacePattern(
  mojoMessages: MojoMessage[],
  cdpEvents: CDPEvent[],
  state: CorrelationState,
): void {
  for (const msg of mojoMessages) {
    if (state.matchedMojoIds.has(msg.messageId)) {
      continue;
    }

    for (const pattern of INTERFACE_TO_CDP_PATTERNS) {
      if (!pattern.mojoPattern.test(msg.interface)) {
        continue;
      }

      const matchingCdp = cdpEvents.find(
        (evt) => pattern.cdpPattern.test(evt.eventType) && !state.matchedCdpEvents.has(evt),
      );
      if (matchingCdp) {
        state.matchedPairs.push({
          mojoMessageId: msg.messageId,
          matchType: 'interface',
          cdpEventType: matchingCdp.eventType,
        });
        state.matchedMojoIds.add(msg.messageId);
        state.matchedCdpEvents.add(matchingCdp);
        break;
      }
    }
  }
}

/** Pass 2: URLLoader messages → network requests. Closest-timestamp within
 * the window — a plain find() would pick the first request in the window
 * even when a nearer one exists (bursty network activity). */
function matchUrlLoaderToRequests(
  mojoMessages: MojoMessage[],
  networkRequests: NetworkRequest[],
  state: CorrelationState,
  bridge: CrossDomainEvidenceBridge,
  requestNodeIds: Map<string, string>,
  mojoNodeMap: Map<string, string>,
): void {
  for (const msg of mojoMessages) {
    if (state.matchedMojoIds.has(msg.messageId)) {
      continue;
    }

    if (!/URLLoader/i.test(msg.interface)) continue;

    let closestDelta = Infinity;
    let matchingReq: NetworkRequest | undefined;
    if (msg.timestamp > 0) {
      for (const req of networkRequests) {
        if (req.timestamp <= 0 || state.matchedRequestIds.has(req.requestId)) continue;
        const delta = Math.abs(req.timestamp - msg.timestamp);
        if (delta <= TIMESTAMP_PROXIMITY_MS && delta < closestDelta) {
          closestDelta = delta;
          matchingReq = req;
        }
      }
    }
    if (matchingReq) {
      recordUrlLoaderMatch(bridge, state, msg, matchingReq, requestNodeIds, mojoNodeMap);
    }
  }
}

function recordUrlLoaderMatch(
  bridge: CrossDomainEvidenceBridge,
  state: CorrelationState,
  msg: MojoMessage,
  matchingReq: NetworkRequest,
  requestNodeIds: Map<string, string>,
  mojoNodeMap: Map<string, string>,
): void {
  const requestNodeId = requestNodeIds.get(matchingReq.requestId);
  const mojoNodeId = mojoNodeMap.get(msg.messageId);
  if (requestNodeId && mojoNodeId) {
    bridge.getGraph().addEdge(requestNodeId, mojoNodeId, 'mojo-routed-to', {
      domain: 'cross-domain',
      relation: 'network-request-correlates-to-mojo',
      matchType: 'urlloader',
      timestampDelta: Math.abs(matchingReq.timestamp - msg.timestamp),
    });
  }
  state.matchedPairs.push({
    mojoMessageId: msg.messageId,
    matchType: 'urlloader',
    networkRequestId: matchingReq.requestId,
    timestampDelta: Math.abs(matchingReq.timestamp - msg.timestamp),
  });
  state.matchedMojoIds.add(msg.messageId);
  state.matchedRequestIds.add(matchingReq.requestId);
}

/** Pass 3: fallback timestamp proximity for the remaining unmatched messages.
 * A zero timestamp means the field was missing from the source data —
 * proximity matching on it would correlate everything to everything, so
 * messages/events without timestamps are skipped. */
function matchByTimestampProximity(
  mojoMessages: MojoMessage[],
  cdpEvents: CDPEvent[],
  state: CorrelationState,
): void {
  for (const msg of mojoMessages) {
    if (state.matchedMojoIds.has(msg.messageId)) {
      continue;
    }

    let closestDelta = Infinity;
    let closestCdp: CDPEvent | undefined;
    if (msg.timestamp > 0) {
      for (const evt of cdpEvents) {
        if (state.matchedCdpEvents.has(evt) || evt.timestamp <= 0) continue;
        const delta = Math.abs(evt.timestamp - msg.timestamp);
        if (delta <= TIMESTAMP_PROXIMITY_MS && delta < closestDelta) {
          closestDelta = delta;
          closestCdp = evt;
        }
      }
    }

    if (closestCdp) {
      state.matchedPairs.push({
        mojoMessageId: msg.messageId,
        matchType: 'timestamp',
        cdpEventType: closestCdp.eventType,
        timestampDelta: closestDelta,
      });
      state.matchedMojoIds.add(msg.messageId);
      state.matchedCdpEvents.add(closestCdp);
    }
  }
}
