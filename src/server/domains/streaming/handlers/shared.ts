/**
 * Shared types and state for streaming sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import { RingBuffer } from '@utils/RingBuffer';

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
  };
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

export function compileRegex(pattern: string): { regex?: RegExp; error?: string } {
  try {
    return { regex: new RegExp(pattern) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
