import type { NetworkTraceResource } from '@modules/trace/TraceDB.types';
import type { TraceNetworkCaptureOptions } from '@modules/trace/TraceRecorder.types';

export type CDPEventHandler = (params: unknown) => void;
export type UnknownRecord = Record<string, unknown>;

export interface EventTiming {
  timestamp: number;
  wallTime: number | null;
  monotonicTime: number | null;
}

export interface ResponseBodyPayload {
  body: string;
  base64Encoded: boolean;
}

export const CDP_EVENTS_BY_DOMAIN: Record<string, string[]> = {
  Debugger: ['Debugger.paused', 'Debugger.resumed', 'Debugger.scriptParsed'],
  Runtime: ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown'],
  Network: [
    'Network.requestWillBeSent',
    'Network.requestServedFromCache',
    'Network.responseReceived',
    'Network.dataReceived',
    'Network.loadingFinished',
    'Network.loadingFailed',
    'Network.eventSourceMessageReceived',
    'Network.webSocketCreated',
    'Network.webSocketWillSendHandshakeRequest',
    'Network.webSocketHandshakeResponseReceived',
    'Network.webSocketFrameReceived',
    'Network.webSocketFrameSent',
    'Network.webSocketFrameError',
    'Network.webSocketClosed',
  ],
  Page: ['Page.navigatedWithinDocument', 'Page.loadEventFired'],
};

export const DEFAULT_CDP_DOMAINS = ['Debugger', 'Runtime', 'Network', 'Page'];

export const DEFAULT_NETWORK_CAPTURE: Required<TraceNetworkCaptureOptions> = {
  recordResponseBodies: true,
  streamResponseChunks: true,
  maxBodyBytes: 10 * 1024 * 1024,
  inlineBodyBytes: 256 * 1024,
};

const MAX_INLINE_EVENT_FIELD_BYTES = 16 * 1024;

export const isObjectRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

export const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const toCdpMilliseconds = (value: unknown): number | null => {
  const num = asFiniteNumber(value);
  if (num === null) return null;
  return num > 1e12 ? num : num * 1000;
};

export const isResponseBodyPayload = (value: unknown): value is ResponseBodyPayload =>
  isObjectRecord(value) &&
  typeof value.body === 'string' &&
  typeof value.base64Encoded === 'boolean';

export const extractEventTiming = (params: unknown): EventTiming => {
  const receivedAt = Date.now();
  if (!isObjectRecord(params)) {
    return { timestamp: receivedAt, wallTime: receivedAt, monotonicTime: null };
  }

  const wallTime = toCdpMilliseconds(params['wallTime']);
  const monotonicTime = toCdpMilliseconds(params['timestamp']);
  return {
    timestamp: wallTime ?? receivedAt,
    wallTime: wallTime ?? receivedAt,
    monotonicTime,
  };
};

export const extractRequestId = (params: unknown): string | null => {
  if (!isObjectRecord(params)) return null;
  return typeof params['requestId'] === 'string' ? params['requestId'] : null;
};

export const extractScriptLocation = (
  eventName: string,
  params: unknown,
): { scriptId: string | null; lineNumber: number | null } => {
  let scriptId: string | null = null;
  let lineNumber: number | null = null;

  if (!isObjectRecord(params)) {
    return { scriptId, lineNumber };
  }

  if ('scriptId' in params) scriptId = String(params['scriptId']);
  if ('lineNumber' in params) lineNumber = Number(params['lineNumber']) || null;

  if (eventName === 'Debugger.paused' && Array.isArray(params['callFrames'])) {
    const frame = (params['callFrames'] as Array<Record<string, unknown>>)[0];
    if (frame) {
      const location = frame['location'] as Record<string, unknown> | undefined;
      if (location) {
        scriptId = String(location['scriptId'] ?? scriptId);
        lineNumber = Number(location['lineNumber'] ?? lineNumber) || null;
      }
    }
  }

  return { scriptId, lineNumber };
};

export const sanitizeTracePayload = (eventName: string, params: unknown): unknown => {
  if (!isObjectRecord(params)) {
    return params ?? {};
  }

  const cloned: UnknownRecord = { ...params };

  if (eventName === 'Network.dataReceived' && typeof cloned['data'] === 'string') {
    const chunk = cloned['data'] as string;
    cloned['hasChunkData'] = true;
    cloned['chunkDataBytes'] = Buffer.byteLength(chunk, 'utf8');
    cloned['data'] = '[captured in network_chunks]';
  }

  if (
    eventName === 'Network.eventSourceMessageReceived' &&
    typeof cloned['data'] === 'string' &&
    Buffer.byteLength(cloned['data'], 'utf8') > MAX_INLINE_EVENT_FIELD_BYTES
  ) {
    const message = cloned['data'] as string;
    cloned['data'] = `${message.slice(0, MAX_INLINE_EVENT_FIELD_BYTES)}...[truncated]`;
    cloned['truncatedData'] = true;
  }

  if (
    (eventName === 'Network.webSocketFrameReceived' ||
      eventName === 'Network.webSocketFrameSent') &&
    isObjectRecord(cloned['response']) &&
    typeof cloned['response']['payloadData'] === 'string'
  ) {
    const response = { ...(cloned['response'] as UnknownRecord) };
    const payload = response['payloadData'] as string;
    if (Buffer.byteLength(payload, 'utf8') > MAX_INLINE_EVENT_FIELD_BYTES) {
      response['payloadData'] = `${payload.slice(0, MAX_INLINE_EVENT_FIELD_BYTES)}...[truncated]`;
      response['truncatedPayloadData'] = true;
      cloned['response'] = response;
    }
  }

  return cloned;
};

export const extractRemoteAddress = (response: UnknownRecord): string | null => {
  const ip = asString(response['remoteIPAddress']);
  const port = asFiniteNumber(response['remotePort']);
  if (!ip) return null;
  return port !== null ? `${ip}:${port}` : ip;
};

export const createNetworkTraceResource = (requestId: string): NetworkTraceResource => ({
  requestId,
  url: null,
  method: null,
  resourceType: null,
  requestHeaders: '{}',
  requestPostData: null,
  status: null,
  statusText: null,
  responseHeaders: '{}',
  mimeType: null,
  protocol: null,
  remoteAddress: null,
  fromDiskCache: false,
  fromServiceWorker: false,
  startedWallTime: null,
  responseWallTime: null,
  finishedWallTime: null,
  startedMonotonicTime: null,
  responseMonotonicTime: null,
  finishedMonotonicTime: null,
  encodedDataLength: null,
  receivedDataLength: 0,
  receivedEncodedDataLength: 0,
  chunkCount: 0,
  streamingEnabled: false,
  streamingSupported: null,
  streamingError: null,
  bodyCaptureState: 'none',
  bodyInline: null,
  bodyArtifactPath: null,
  bodyBase64Encoded: false,
  bodySize: null,
  bodyTruncated: false,
  bodyError: null,
  failed: false,
  errorText: null,
});
