/**
 * Shared types and state for streaming sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { RingBuffer } from '@utils/RingBuffer';
import type { GrpcMessageFrame } from '@server/domains/network/grpc-raw';

export type TextToolResponse = {
  content: [{ type: 'text'; text: string }];
};

export type WsDirection = 'sent' | 'received';
export type WsQueryDirection = WsDirection | 'all';
export type CdpEventPayload = unknown;
export type CdpEventHandler = (params: CdpEventPayload) => void;

export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: CdpEventHandler): void;
  off(event: string, handler: CdpEventHandler): void;
  detach(): Promise<void>;
}

export interface WsFrameRecord {
  requestId: string;
  timestamp: number;
  direction: WsDirection;
  opcode: number;
  payloadLength: number;
  payloadPreview: string;
  payloadSample: string;
  payload?: string;
  isBinary: boolean;
}

export interface WsFrameOrderEntry {
  requestId: string;
  frame: WsFrameRecord;
}

export interface WsMonitorListeners {
  created: CdpEventHandler;
  closed: CdpEventHandler;
  handshake: CdpEventHandler;
  frameSent: CdpEventHandler;
  frameReceived: CdpEventHandler;
}

export interface SseEventRecord {
  sourceUrl: string;
  eventType: string;
  dataPreview: string;
  data?: string;
  dataLength: number;
  lastEventId: string | null;
  timestamp: number;
}

export interface SseEnableResult {
  success: boolean;
  message: string;
  patched: boolean;
  urlFilter?: string;
  maxEvents: number;
  existingEvents: number;
}

// ── gRPC ──

/** A captured gRPC / gRPC-Web call (one HTTP/2 request + response). */
export interface GrpcCallRecord {
  requestId: string;
  url: string;
  method: string;
  /** HTTP response status (0 until responseReceived). */
  status: number;
  requestContentType: string | null;
  responseContentType: string | null;
  createdTimestamp: number;
  finishedTimestamp: number | null;
  requestBodyBytes: number;
  responseBodyBytes: number;
  /** Messages parsed from the response body (primary RE target; reliably base64 via getResponseBody). */
  responseMessages: GrpcMessageFrame[];
  /** Messages parsed from the request body (best-effort; CDP request-body encoding is less reliable for binary). */
  requestMessages: GrpcMessageFrame[];
  warnings: string[];
  /** Set when Network.getResponseBody failed for this call. */
  bodyError: string | null;
}

export interface GrpcMonitorListeners {
  requestWillBeSent: CdpEventHandler;
  responseReceived: CdpEventHandler;
  loadingFinished: CdpEventHandler;
}

export interface StreamingSharedState {
  collector: CodeCollector;

  wsSession: CdpSessionLike | null;
  wsListeners: WsMonitorListeners | null;
  wsConfig: {
    enabled: boolean;
    maxFrames: number;
    urlFilterRaw?: string;
    urlFilter?: RegExp;
  };
  wsFramesByRequest: Map<string, WsFrameRecord[]>;
  wsFrameOrder: RingBuffer<WsFrameOrderEntry>;
  wsConnections: Map<
    string,
    {
      requestId: string;
      url: string;
      status: 'connecting' | 'open' | 'closed' | 'error';
      framesCount: number;
      createdTimestamp: number;
      closedTimestamp?: number;
      handshakeStatus?: number;
    }
  >;

  sseConfig: { maxEvents: number; urlFilterRaw?: string };

  /** Config for the fetch()-based stream monitor (re-applied on re-enable). */
  fetchStreamConfig: { maxEvents: number; urlFilterRaw?: string };

  /** Config for the WebRTC data-channel monitor (re-applied on re-enable). */
  webrtcConfig: { maxEvents: number; urlFilterRaw?: string };

  grpcSession: CdpSessionLike | null;
  grpcListeners: GrpcMonitorListeners | null;
  grpcConfig: {
    enabled: boolean;
    maxCalls: number;
    urlFilterRaw?: string;
    urlFilter?: RegExp;
  };
  /** requestId → captured call (insertion order = capture order). */
  grpcCalls: Map<string, GrpcCallRecord>;
  /** requestIds in capture order, for ring-buffer cap enforcement. */
  grpcCallOrder: RingBuffer<string>;
}

export function createStreamingSharedState(collector: CodeCollector): StreamingSharedState {
  return {
    collector,
    wsSession: null,
    wsListeners: null,
    wsConfig: { enabled: false, maxFrames: 1000 },
    wsFramesByRequest: new Map(),
    wsFrameOrder: new RingBuffer<WsFrameOrderEntry>(1000),
    wsConnections: new Map(),
    sseConfig: { maxEvents: 2000 },
    fetchStreamConfig: { maxEvents: 2000 },
    webrtcConfig: { maxEvents: 2000 },
    grpcSession: null,
    grpcListeners: null,
    grpcConfig: { enabled: false, maxCalls: 100 },
    grpcCalls: new Map(),
    grpcCallOrder: new RingBuffer<string>(100),
  };
}

/** True for application/grpc, application/grpc+proto, application/grpc-web(+proto). */
export function isGrpcContentType(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.trim().toLowerCase().startsWith('application/grpc');
}

// ── Shared helpers ──

export function asJson(payload: unknown): TextToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export function parseOptionalStringArg(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseNumberArg(
  value: unknown,
  options: { defaultValue: number; min: number; max: number; integer?: boolean },
): number {
  let parsed: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    parsed = value;
  } else if (typeof value === 'string') {
    const n = Number(value.trim());
    if (Number.isFinite(n)) parsed = n;
  }
  if (parsed === undefined) parsed = options.defaultValue;
  if (options.integer) parsed = Math.trunc(parsed);
  if (parsed < options.min) parsed = options.min;
  if (parsed > options.max) parsed = options.max;
  return parsed;
}

export function parseWsDirection(value: unknown): WsQueryDirection {
  if (value === 'sent' || value === 'received' || value === 'all') return value;
  return 'all';
}

export function parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return defaultValue;
}

export function compileRegex(pattern: string): { regex?: RegExp; error?: string } {
  try {
    return { regex: new RegExp(pattern) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
