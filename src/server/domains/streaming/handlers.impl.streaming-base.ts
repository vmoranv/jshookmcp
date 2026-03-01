import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { RingBuffer } from '../../../utils/RingBuffer.js';

export type TextToolResponse = {
  content: [{ type: 'text'; text: string }];
};

export type WsDirection = 'sent' | 'received';
export type WsQueryDirection = WsDirection | 'all';
export type CdpEventPayload = unknown;
export type CdpEventHandler = (params: CdpEventPayload) => void;

export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: CdpEventHandler): void; // CDP event payload is dynamic
  off(event: string, handler: CdpEventHandler): void; // CDP event payload is dynamic
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

interface WsConnectionRecord {
  requestId: string;
  url: string;
  status: 'connecting' | 'open' | 'closed' | 'error';
  framesCount: number;
  createdTimestamp: number;
  closedTimestamp?: number;
  handshakeStatus?: number;
}

interface WsMonitorConfig {
  enabled: boolean;
  maxFrames: number;
  urlFilterRaw?: string;
  urlFilter?: RegExp;
}

export interface WsMonitorListeners {
  created: CdpEventHandler; // CDP event payload is dynamic
  closed: CdpEventHandler; // CDP event payload is dynamic
  handshake: CdpEventHandler; // CDP event payload is dynamic
  frameSent: CdpEventHandler; // CDP event payload is dynamic
  frameReceived: CdpEventHandler; // CDP event payload is dynamic
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


export class StreamingToolHandlersBase {
  protected collector: CodeCollector;

  protected wsSession: CdpSessionLike | null = null;
  protected wsListeners: WsMonitorListeners | null = null;
  protected wsConfig: WsMonitorConfig = {
    enabled: false,
    maxFrames: 1000,
  };

  // Required by spec: frames are grouped by requestId in a protected Map.
  protected wsFramesByRequest = new Map<string, WsFrameRecord[]>();
  protected wsFrameOrder = new RingBuffer<WsFrameOrderEntry>(1000);
  protected wsConnections = new Map<string, WsConnectionRecord>();

  protected sseConfig: { maxEvents: number; urlFilterRaw?: string } = {
    maxEvents: 2000,
  };

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  protected asJson(payload: unknown): TextToolResponse {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
  }

  protected parseOptionalStringArg(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  protected parseNumberArg(
    value: unknown,
    options: { defaultValue: number; min: number; max: number; integer?: boolean }
  ): number {
    let parsed: number | undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === 'string') {
      const n = Number(value.trim());
      if (Number.isFinite(n)) {
        parsed = n;
      }
    }

    if (parsed === undefined) {
      parsed = options.defaultValue;
    }

    if (options.integer) {
      parsed = Math.trunc(parsed);
    }

    if (parsed < options.min) {
      parsed = options.min;
    }
    if (parsed > options.max) {
      parsed = options.max;
    }
    return parsed;
  }

  protected parseWsDirection(value: unknown): WsQueryDirection {
    if (value === 'sent' || value === 'received' || value === 'all') {
      return value;
    }
    return 'all';
  }

  protected compileRegex(pattern: string): { regex?: RegExp; error?: string } {
    try {
      return { regex: new RegExp(pattern) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  protected getWsFrameStats(): { total: number; sent: number; received: number } {
    let sent = 0;
    let received = 0;

    for (const entry of this.wsFrameOrder) {
      if (entry.frame.direction === 'sent') {
        sent += 1;
      } else {
        received += 1;
      }
    }

    return {
      total: this.wsFrameOrder.length,
      sent,
      received,
    };
  }

  protected appendWsFrame(requestId: string, frame: WsFrameRecord): void {
    const list = this.wsFramesByRequest.get(requestId) ?? [];
    list.push(frame);
    this.wsFramesByRequest.set(requestId, list);

    const connection = this.wsConnections.get(requestId);
    if (connection) {
      connection.framesCount += 1;
      if (connection.status === 'connecting') {
        connection.status = 'open';
      }
    }

    this.wsFrameOrder.push({ requestId, frame });
    this.enforceWsFrameLimit();
  }

  protected enforceWsFrameLimit(): void {
    while (this.wsFrameOrder.length > this.wsConfig.maxFrames) {
      const oldest = this.wsFrameOrder.shift();
      if (!oldest) {
        break;
      }

      const bucket = this.wsFramesByRequest.get(oldest.requestId);
      if (bucket && bucket.length > 0) {
        bucket.shift();
        if (bucket.length === 0) {
          this.wsFramesByRequest.delete(oldest.requestId);
        } else {
          this.wsFramesByRequest.set(oldest.requestId, bucket);
        }
      }

      const connection = this.wsConnections.get(oldest.requestId);
      if (connection) {
        connection.framesCount = Math.max(0, connection.framesCount - 1);
      }
    }
  }

}

