import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
} from '@modelcontextprotocol/server';
import type {
  Transport,
  TransportSendOptions,
  JSONRPCMessage,
  MessageExtraInfo,
  RequestId,
} from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { logger } from '@utils/logger';
import { HTTP_CAPACITY_RETRY_AFTER_MS, MCP_HTTP_JSON_RESPONSE } from '@src/constants';
import { readEnvInteger } from '@src/config/environment';

// Notifications (e.g. logging messages) are broadcast to every HTTP session.
// Skip sessions idle past this threshold to bound the O(log × sessions)
// amplification under load instead of fanning out to the full session table.
const DEFAULT_BROADCAST_IDLE_TTL_MS = 5 * 60 * 1000;

/**
 * Per-session in-flight request cap. `inFlight` previously only counted — never
 * bounded — so a single session could pile up unbounded concurrent requests and
 * exhaust the process (a1-06). Overridable via MCP_HTTP_MAX_INFLIGHT.
 */
const DEFAULT_MAX_INFLIGHT = 64;

/**
 * Per-session cap on concurrent SSE GET streams (the server→client event
 * channel). A client holds one GET open while awaiting notifications, so these
 * are long-lived. Counting them against `maxInFlight` would let 64 idle GETs
 * self-DoS a session (every subsequent POST gets 503), so they are bounded
 * separately at a small limit — this also prevents a hostile client from
 * holding open unbounded half-open streams. Overridable via MCP_HTTP_MAX_SSE_INFLIGHT.
 */
const DEFAULT_MAX_SSE_INFLIGHT = 8;

interface SessionRecord {
  sessionId: string;
  transport: NodeStreamableHTTPServerTransport;
  lastTouchedAt: number;
  inFlight: number;
  sseInFlight: number;
}

interface RequestRouteRecord {
  sessionId: string;
  originalId: RequestId;
  transport: NodeStreamableHTTPServerTransport;
}

export interface MultiplexedStreamableHttpTransportOptions {
  onSessionClosed?: (sessionId: string) => void;
  onSessionOpened?: (sessionId: string) => void | Promise<void>;
  maxSessions?: number;
  maxInFlight?: number;
  maxSseInFlight?: number;
  capacityRetryAfterMs?: number;
  sessionIdleTtlMs?: number;
  broadcastIdleTtlMs?: number;
  now?: () => number;
}

function getSessionHeader(req: IncomingMessage): string | null {
  const raw = req.headers['mcp-session-id'];
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' && raw[0].trim().length > 0 ? raw[0].trim() : null;
  }
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function keyForRequestId(id: RequestId): string {
  return typeof id === 'string' ? `s:${id}` : `n:${String(id)}`;
}

export class MultiplexedStreamableHttpTransport implements Transport {
  private readonly options: MultiplexedStreamableHttpTransportOptions;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  sessionId?: string;

  private started = false;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly requestRoutes = new Map<string, RequestRouteRecord>();
  private readonly sessionOriginalToInternal = new Map<string, Map<string, string>>();
  private readonly maxInFlight: number;
  private readonly maxSseInFlight: number;
  private pendingSessionAdmissions = 0;
  private requestSequence = 0;

  constructor(options: MultiplexedStreamableHttpTransportOptions = {}) {
    this.options = options;
    this.maxInFlight =
      options.maxInFlight ??
      readEnvInteger('MCP_HTTP_MAX_INFLIGHT', DEFAULT_MAX_INFLIGHT, { min: 1 });
    this.maxSseInFlight =
      options.maxSseInFlight ??
      readEnvInteger('MCP_HTTP_MAX_SSE_INFLIGHT', DEFAULT_MAX_SSE_INFLIGHT, { min: 1 });
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('MultiplexedStreamableHttpTransport already started');
    }
    this.started = true;
  }

  async close(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.requestRoutes.clear();
    this.sessionOriginalToInternal.clear();
    for (const session of sessions) this.notifySessionClosed(session.sessionId);
    await Promise.allSettled(sessions.map((session) => session.transport.close()));
    this.onclose?.();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const routeKey = this.resolveRouteKey(message, options);
    if (routeKey) {
      const route = this.requestRoutes.get(routeKey);
      if (route) {
        const translatedMessage =
          isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)
            ? { ...message, id: route.originalId }
            : message;
        const translatedOptions =
          options?.relatedRequestId !== undefined
            ? { ...options, relatedRequestId: route.originalId }
            : options;
        await route.transport.send(translatedMessage, translatedOptions);
        if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
          this.releaseRequestRoute(routeKey, route);
        }
        return;
      }
    }

    const sessions = [...this.sessions.values()];
    if (sessions.length === 0) {
      return;
    }

    if (isJSONRPCNotification(message)) {
      const activeSessions = this.getActiveBroadcastSessions();
      if (activeSessions.length > 0) {
        await Promise.allSettled(
          activeSessions.map((session) => session.transport.send(message, options)),
        );
      }
      return;
    }

    if (sessions.length === 1) {
      await sessions[0]!.transport.send(message, options);
      return;
    }

    throw new Error('Ambiguous HTTP session for outbound request/response routing.');
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    const sessionId = getSessionHeader(req);

    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (!existing) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: `Unknown MCP session: ${sessionId}`,
            },
            id: null,
          }),
        );
        return;
      }
      const now = this.getNow();
      const idleTtlMs = this.options.sessionIdleTtlMs ?? Number.POSITIVE_INFINITY;
      if (
        existing.inFlight === 0 &&
        existing.sseInFlight === 0 &&
        now - existing.lastTouchedAt >= idleTtlMs
      ) {
        this.dropSession(sessionId);
        await existing.transport.close().catch(() => undefined);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: `Expired MCP session: ${sessionId}`,
              data: { code: 'MCP_SESSION_EXPIRED' },
            },
            id: null,
          }),
        );
        return;
      }

      // SSE GET streams are long-lived and must not count against the POST
      // in-flight cap (they would self-DoS the session); they get their own
      // small limit instead.
      const isGet = (req.method ?? '').toUpperCase() === 'GET';
      if (isGet) {
        const maxSseInFlight = this.maxSseInFlight;
        if (existing.sseInFlight >= maxSseInFlight) {
          const retryAfterMs = this.options.capacityRetryAfterMs ?? HTTP_CAPACITY_RETRY_AFTER_MS;
          res.writeHead(503, {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
          });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32001,
                message: 'MCP session SSE stream capacity reached',
                data: {
                  code: 'MCP_SESSION_SSE_CAPACITY',
                  retryAfterMs,
                  sseInFlight: existing.sseInFlight,
                  sseInFlightLimit: maxSseInFlight,
                  sessionId,
                },
              },
              id: null,
            }),
          );
          return;
        }
        existing.sseInFlight += 1;
      } else {
        const maxInFlight = this.maxInFlight;
        if (existing.inFlight >= maxInFlight) {
          const retryAfterMs = this.options.capacityRetryAfterMs ?? HTTP_CAPACITY_RETRY_AFTER_MS;
          res.writeHead(503, {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
          });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32001,
                message: 'MCP session in-flight capacity reached',
                data: {
                  code: 'MCP_SESSION_INFLIGHT_CAPACITY',
                  retryAfterMs,
                  inFlight: existing.inFlight,
                  inFlightLimit: maxInFlight,
                  sessionId,
                },
              },
              id: null,
            }),
          );
          return;
        }
        existing.inFlight += 1;
      }
      existing.lastTouchedAt = now;
      try {
        await existing.transport.handleRequest(req, res, parsedBody);
      } finally {
        if (isGet) {
          existing.sseInFlight = Math.max(0, existing.sseInFlight - 1);
        } else {
          existing.inFlight = Math.max(0, existing.inFlight - 1);
        }
        existing.lastTouchedAt = this.getNow();
      }
      return;
    }

    const maxSessions = this.options.maxSessions ?? Number.MAX_SAFE_INTEGER;
    if (this.getSessionAdmissionUsage() >= maxSessions) await this.evictExpiredSessions();
    if (this.getSessionAdmissionUsage() >= maxSessions) {
      const retryAfterMs = this.options.capacityRetryAfterMs ?? HTTP_CAPACITY_RETRY_AFTER_MS;
      const admissionUsage = this.getSessionAdmissionUsage();
      res.writeHead(503, {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
      });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'MCP session capacity reached',
            data: {
              code: 'MCP_SESSION_CAPACITY',
              retryAfterMs,
              sessionCount: admissionUsage,
              sessionLimit: maxSessions,
              pendingAdmissions: this.pendingSessionAdmissions,
            },
          },
          id: null,
        }),
      );
      return;
    }

    const candidateSessionId = randomUUID();
    this.pendingSessionAdmissions += 1;
    let admissionClaimed = false;
    let registered = false;
    let transport: NodeStreamableHTTPServerTransport | null = null;
    try {
      try {
        if (this.options.onSessionOpened) {
          await this.options.onSessionOpened(candidateSessionId);
          admissionClaimed = true;
        }
      } catch (error) {
        logger.warn(
          `[http] MCP session admission hook failed for ${candidateSessionId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        this.writeSessionAdmissionError(res, error);
        return;
      }

      transport = this.createInnerTransport(candidateSessionId);
      try {
        await transport.handleRequest(req, res, parsedBody);
      } catch (error) {
        await transport.close().catch(() => undefined);
        throw error;
      }

      if (transport.sessionId) {
        if (transport.sessionId !== candidateSessionId) {
          await transport.close().catch(() => undefined);
          throw new Error(
            `Inner HTTP transport changed its reserved session id from ` +
              `${candidateSessionId} to ${transport.sessionId}`,
          );
        }
        if (!this.sessions.has(candidateSessionId)) {
          this.sessions.set(candidateSessionId, {
            sessionId: candidateSessionId,
            transport,
            lastTouchedAt: this.getNow(),
            inFlight: 0,
            sseInFlight: 0,
          });
          registered = true;
        }
      } else {
        await transport.close().catch(() => undefined);
      }
    } finally {
      this.pendingSessionAdmissions = Math.max(0, this.pendingSessionAdmissions - 1);
      // Release the admission claim (fleet lease) on EVERY failure path —
      // including createInnerTransport() throwing above, where the old code
      // skipped the notification and leaked the lease.
      if (!registered && admissionClaimed) {
        this.notifySessionClosed(candidateSessionId);
      }
      if (!registered && transport?.sessionId === candidateSessionId) {
        await transport.close().catch(() => undefined);
      }
    }
  }

  getStats(): {
    sessions: number;
    sessionLimit: number;
    sessionIdleTtlMs: number | null;
    inFlight: number;
    pendingAdmissions: number;
  } {
    let inFlight = 0;
    for (const session of this.sessions.values()) inFlight += session.inFlight;
    return {
      sessions: this.sessions.size,
      sessionLimit: this.options.maxSessions ?? Number.MAX_SAFE_INTEGER,
      sessionIdleTtlMs: this.options.sessionIdleTtlMs ?? null,
      inFlight,
      pendingAdmissions: this.pendingSessionAdmissions,
    };
  }

  private createInnerTransport(sessionId: string): NodeStreamableHTTPServerTransport {
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      // MCP_HTTP_JSON_RESPONSE switches the SDK into "JSON response" mode
      // (application/json body instead of an SSE stream). Two documented
      // trade-offs (see the constant's JSDoc in @src/constants/server.ts):
      //   1. In-tool-call elicitation/sampling requests (sent with a
      //      relatedRequestId) are silently dropped by the SDK in this mode, so
      //      ElicitationBridge / LLMSamplingBridge delegation breaks. We do NOT
      //      degrade those messages back to SSE here: the drop happens inside
      //      the SDK's inner transport (out of reach of this multiplexer), and
      //      stripping their relatedRequestId would change routing semantics in
      //      multi-session deployments. The flag therefore defaults OFF.
      //   2. No streaming first byte: the response is buffered until all
      //      replies are ready, so long tasks lose progressive output.
      enableJsonResponse: MCP_HTTP_JSON_RESPONSE,
    });

    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onmessage = (message, extra) => {
      const currentSessionId = transport.sessionId;
      const rewritten = currentSessionId
        ? this.rewriteInboundMessage(currentSessionId, transport, message)
        : message;

      this.onmessage?.(rewritten as typeof message, {
        ...extra,
      });
    };

    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onerror = (error) => {
      this.onerror?.(error);
    };

    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onclose = () => {
      if (transport.sessionId) {
        this.dropSession(transport.sessionId);
      }
    };

    return transport;
  }

  private rewriteInboundMessage(
    sessionId: string,
    transport: NodeStreamableHTTPServerTransport,
    message: JSONRPCMessage,
  ): JSONRPCMessage {
    if (isJSONRPCRequest(message)) {
      const internalId = `http:${sessionId}:${++this.requestSequence}`;
      this.requestRoutes.set(internalId, {
        sessionId,
        originalId: message.id,
        transport,
      });
      let perSession = this.sessionOriginalToInternal.get(sessionId);
      if (!perSession) {
        perSession = new Map<string, string>();
        this.sessionOriginalToInternal.set(sessionId, perSession);
      }
      perSession.set(keyForRequestId(message.id), internalId);
      const params =
        typeof message.params === 'object' && message.params !== null
          ? (message.params as Record<string, unknown>)
          : {};
      const meta =
        typeof params['_meta'] === 'object' && params['_meta'] !== null
          ? (params['_meta'] as Record<string, unknown>)
          : {};
      return {
        ...message,
        id: internalId,
        params: {
          ...params,
          _meta: {
            ...meta,
            sessionId,
          },
        },
      };
    }

    if (isJSONRPCNotification(message) && message.method === 'notifications/cancelled') {
      const params =
        typeof message.params === 'object' && message.params !== null
          ? (message.params as Record<string, unknown>)
          : null;
      const requestId = params?.['requestId'];
      if (typeof requestId === 'string' || typeof requestId === 'number') {
        const internalId = this.sessionOriginalToInternal
          .get(sessionId)
          ?.get(keyForRequestId(requestId as RequestId));
        if (internalId) {
          return {
            ...message,
            params: {
              ...params,
              requestId: internalId,
            },
          };
        }
      }
    }

    return message;
  }

  private resolveRouteKey(message: JSONRPCMessage, options?: TransportSendOptions): string | null {
    if (options?.relatedRequestId !== undefined) {
      return String(options.relatedRequestId);
    }
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      return String(message.id);
    }
    return null;
  }

  private releaseRequestRoute(routeKey: string, route: RequestRouteRecord): void {
    this.requestRoutes.delete(routeKey);
    const perSession = this.sessionOriginalToInternal.get(route.sessionId);
    if (!perSession) {
      return;
    }
    perSession.delete(keyForRequestId(route.originalId));
    if (perSession.size === 0) {
      this.sessionOriginalToInternal.delete(route.sessionId);
    }
  }

  private dropSession(sessionId: string): void {
    const existed = this.sessions.delete(sessionId);
    this.sessionOriginalToInternal.delete(sessionId);
    for (const [routeKey, route] of this.requestRoutes) {
      if (route.sessionId === sessionId) {
        this.requestRoutes.delete(routeKey);
      }
    }
    if (existed) this.notifySessionClosed(sessionId);
    logger.info(`[http] MCP session closed: ${sessionId}`);
  }

  private async evictExpiredSessions(): Promise<void> {
    const idleTtlMs = this.options.sessionIdleTtlMs ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(idleTtlMs)) return;
    const cutoff = this.getNow() - idleTtlMs;
    const expired: SessionRecord[] = [];
    for (const session of this.sessions.values()) {
      if (session.inFlight === 0 && session.sseInFlight === 0 && session.lastTouchedAt <= cutoff) {
        expired.push(session);
      }
    }
    for (const session of expired) this.dropSession(session.sessionId);
    await Promise.allSettled(expired.map(async (session) => await session.transport.close()));
  }

  private getActiveBroadcastSessions(): SessionRecord[] {
    const ttlMs = this.options.broadcastIdleTtlMs ?? DEFAULT_BROADCAST_IDLE_TTL_MS;
    if (!Number.isFinite(ttlMs)) return [...this.sessions.values()];
    const cutoff = this.getNow() - ttlMs;
    return [...this.sessions.values()].filter(
      (session) => session.sseInFlight > 0 || session.lastTouchedAt > cutoff,
    );
  }

  private getNow(): number {
    return this.options.now?.() ?? Date.now();
  }

  private getSessionAdmissionUsage(): number {
    return this.sessions.size + this.pendingSessionAdmissions;
  }

  private writeSessionAdmissionError(res: ServerResponse, error: unknown): void {
    const details =
      typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null;
    const retryAfterMs =
      typeof details?.['retryAfterMs'] === 'number' &&
      Number.isFinite(details['retryAfterMs']) &&
      details['retryAfterMs'] >= 0
        ? details['retryAfterMs']
        : (this.options.capacityRetryAfterMs ?? HTTP_CAPACITY_RETRY_AFTER_MS);
    const errorCode =
      typeof details?.['code'] === 'string' ? details['code'] : 'MCP_SESSION_ADMISSION_FAILED';
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
    });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32002,
          message: error instanceof Error ? error.message : 'MCP session admission failed',
          data: {
            code: errorCode,
            retryAfterMs,
            ...(typeof details?.['targetWorkerId'] === 'string'
              ? { targetWorkerId: details['targetWorkerId'] }
              : {}),
            ...(typeof details?.['targetEndpoint'] === 'string'
              ? { targetEndpoint: details['targetEndpoint'] }
              : {}),
          },
        },
        id: null,
      }),
    );
  }

  private notifySessionClosed(sessionId: string): void {
    try {
      this.options.onSessionClosed?.(sessionId);
    } catch (error) {
      logger.warn(
        `[http] session cleanup failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
