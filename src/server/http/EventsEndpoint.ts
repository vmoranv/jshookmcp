/**
 * GET /events — unified Server-Sent Events mirror of the server EventBus.
 *
 * A single bus drives MCP execution telemetry and this SSE surface (the
 * "shared-mirror" pattern): long-running clients (e.g. orchestration agents)
 * subscribe to tool execution / gate / activation events without holding an
 * MCP session open.
 *
 * Contract:
 * - Each bus event is written as exactly one frame: `id: <seq>\ndata: {json}\n\n`
 *   where the JSON is `{ event, payload }` (single line — JSON escapes
 *   newlines). `<seq>` comes from a server-level monotonic counter starting at
 *   1 and shared across connections and replays, so clients can deduplicate,
 *   order, and resume. The sequence travels ONLY in the `id:` line — the JSON
 *   payload is never polluted with it.
 * - Clients may resume with the standard `Last-Event-ID` header (or an
 *   equivalent `?since=<seq>` query parameter): buffered events with
 *   `seq > since` are replayed in order before live events. Without either,
 *   the whole bounded buffer is flushed (legacy behavior).
 * - If the resume point predates the oldest buffered frame, an `event: gap`
 *   frame is written before the replay: the intermediate events are gone
 *   (bounded buffer) and are honestly NOT re-sent — the client must resync.
 * - Heartbeat comment frames (`:ping\n\n`) every SSE_EVENTS_HEARTBEAT_MS to
 *   defeat idle proxy timeouts. Heartbeats never carry an `id:` line.
 * - Only the metadata-only allowlisted events are mirrored. Payloads are
 *   additionally scrubbed of sensitive keys as defense in depth — tool
 *   arguments and results must never reach this stream.
 * - Client disconnects unsubscribe; a bounded replay buffer (most recent
 *   events observed while at least one subscriber was attached) is flushed to
 *   each new connection before live events.
 * - Authentication is NOT applied here: the route in MCPServer.transport.ts
 *   runs the same checkOrigin/checkAuth/checkRateLimit chain as POST /mcp
 *   (Bearer MCP_AUTH_TOKEN when configured). This handler never bypasses it.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { logger } from '@utils/logger';

/** Heartbeat interval for /events (comment frames keep idle proxies open). */
const SSE_EVENTS_HEARTBEAT_MS = 15_000;

/** Replay buffer capacity: most recent mirrored events flushed to new clients. */
const SSE_EVENTS_REPLAY_LIMIT = 100;

/** Upper bound on concurrent /events streams (each is a long-lived socket). */
const SSE_EVENTS_MAX_CLIENTS = 32;

/**
 * Bus events mirrored to SSE subscribers. Metadata-only by contract — see the
 * corresponding payloads in @server/EventBus ServerEventMap.
 */
export const SSE_EVENT_ALLOWLIST: ReadonlySet<string> = new Set([
  'tool.execution.started',
  'tool.execution.finished',
  'tool.gate.denied',
  'tool.activation.changed',
]);

/**
 * Payload keys stripped defensively before an event reaches the stream. The
 * allowlisted events never carry these, but a future emitter regression must
 * not turn /events into a data-exfiltration channel.
 */
const SENSITIVE_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'args',
  'result',
  'content',
  'params',
  '_meta',
]);

/**
 * Shallow-clone and strip sensitive keys from an event payload. Non-object
 * payloads pass through untouched.
 */
export function sanitizeEventPayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const source = payload as Record<string, unknown>;
  let scrubbed: Record<string, unknown> | null = null;
  for (const key of Object.keys(source)) {
    if (!SENSITIVE_PAYLOAD_KEYS.has(key)) continue;
    scrubbed ??= { ...source };
    delete scrubbed[key];
  }
  return scrubbed ?? source;
}

/**
 * Pure SSE frame builder: one bus event → one `id:` line + one `data:` line +
 * blank line. JSON.stringify escapes embedded newlines, so the payload can
 * never split the frame across multiple lines. The sequence number travels
 * ONLY in the `id:` line (SSE resume protocol) — the JSON payload stays pure.
 */
export function formatBusEventFrame(event: string, payload: unknown, seq: number): string {
  return `id: ${seq}\ndata: ${JSON.stringify({ event, payload: sanitizeEventPayload(payload) })}\n\n`;
}

/**
 * Gap notice frame, written before a partial replay when the client's resume
 * point predates the oldest still-buffered event. Standard SSE clients observe
 * it via `addEventListener('gap', …)`; the data line names the requested
 * sequence and the oldest available one. Missing events are not re-sent.
 */
export function formatGapFrame(since: number, oldestAvailable: number): string {
  return `event: gap\ndata: ${JSON.stringify({ since, oldestAvailable })}\n\n`;
}

/** Resume points must be plain non-negative integers (`"3"`, `"0"`). */
const RESUME_SEQUENCE_PATTERN = /^\d+$/;

/**
 * Extract the client resume point: standard `Last-Event-ID` header first,
 * `?since=<seq>` query parameter as fallback. Returns null when neither is
 * present, or when the value is not a non-negative integer — an unusable
 * resume point degrades to the legacy full replay instead of guessing.
 */
export function parseResumeSequence(req: Pick<IncomingMessage, 'headers' | 'url'>): number | null {
  const rawHeader = req.headers['last-event-id'];
  const headerValue = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader)?.trim() ?? '';
  let raw: string | null = RESUME_SEQUENCE_PATTERN.test(headerValue) ? headerValue : null;
  if (raw === null && req.url !== undefined) {
    try {
      const queryValue = new URL(req.url, 'http://localhost').searchParams.get('since');
      if (queryValue !== null && RESUME_SEQUENCE_PATTERN.test(queryValue.trim())) {
        raw = queryValue.trim();
      }
    } catch {
      raw = null;
    }
  }
  return raw === null ? null : Number(raw);
}

interface RecordedEvent {
  /** Server-level monotonic sequence (also carried in the SSE `id:` line). */
  seq: number;
  event: string;
  payload: unknown;
}

export interface EventsEndpointStats {
  activeClients: number;
  buffered: number;
  /** Highest sequence handed out so far; 0 until the first mirrored event. */
  lastSeq: number;
}

export interface EventsEndpoint {
  handleRequest(req: IncomingMessage, res: ServerResponse): void;
  /** Test/observability introspection. */
  getStats(): EventsEndpointStats;
}

export interface EventsEndpointOptions {
  heartbeatMs?: number;
  replayLimit?: number;
  maxClients?: number;
}

/**
 * Create the /events request handler bound to one EventBus.
 *
 * A wildcard recorder is attached lazily while at least one client is
 * connected (zero overhead otherwise); the bounded buffer survives after the
 * last client disconnects so a reconnecting consumer still gets a replay.
 * The recorder is detached when idle — no lifecycle coupling to server close.
 */
export function createEventsEndpoint(
  eventBus: EventBus<ServerEventMap> | undefined | null,
  options: EventsEndpointOptions = {},
): EventsEndpoint {
  const heartbeatMs = options.heartbeatMs ?? SSE_EVENTS_HEARTBEAT_MS;
  const replayLimit = options.replayLimit ?? SSE_EVENTS_REPLAY_LIMIT;
  const maxClients = options.maxClients ?? SSE_EVENTS_MAX_CLIENTS;

  let activeClients = 0;
  let recorderAttached = false;
  let detachRecorder: (() => void) | null = null;
  let lastSeq = 0;
  const replayBuffer: RecordedEvent[] = [];
  const clientSinks = new Set<(frame: string) => void>();

  /**
   * Single dispatch point for mirrored bus events: assigns the server-level
   * sequence number, appends to the replay buffer, and fans the prebuilt frame
   * out to every connected sink. Assigning the seq exactly once here (not once
   * per subscriber) guarantees that the live frame and the replay frame for
   * the same event carry one identical sequence number.
   */
  const dispatchMirroredEvent = (event: string, rawPayload: unknown): void => {
    if (!SSE_EVENT_ALLOWLIST.has(event)) return;
    const recorded: RecordedEvent = {
      seq: lastSeq + 1,
      event,
      payload: sanitizeEventPayload(rawPayload),
    };
    lastSeq = recorded.seq;
    replayBuffer.push(recorded);
    if (replayBuffer.length > replayLimit) {
      replayBuffer.splice(0, replayBuffer.length - replayLimit);
    }
    const frame = formatBusEventFrame(recorded.event, recorded.payload, recorded.seq);
    for (const sink of clientSinks) sink(frame);
  };

  const ensureRecorder = (): void => {
    if (recorderAttached || !eventBus || typeof eventBus.onAny !== 'function') return;
    recorderAttached = true;
    detachRecorder = eventBus.onAny(({ event, payload }) => {
      dispatchMirroredEvent(event, payload);
    });
  };

  const maybeDetachRecorder = (): void => {
    if (!recorderAttached || activeClients > 0) return;
    detachRecorder?.();
    detachRecorder = null;
    recorderAttached = false;
  };

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (!eventBus || typeof eventBus.onAny !== 'function') {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Service Unavailable – event bus not initialized');
      return;
    }
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed – use GET /events');
      return;
    }
    if (activeClients >= maxClients) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end(`Service Unavailable – /events stream limit reached (${maxClients})`);
      return;
    }

    activeClients += 1;
    // Attach the recorder BEFORE reading the buffer inside this synchronous
    // setup: events emitted before this call are already buffered, events
    // after it reach the live sink — no gap, no duplicates.
    ensureRecorder();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Auth/contract documentation lives in comment frames (SSE clients ignore
    // colon-prefixed lines). Auth itself is enforced by the /events route in
    // MCPServer.transport.ts — same chain as POST /mcp.
    res.write(': jshookmcp unified event stream (GET /events)\n');
    res.write(
      ': auth mirrors POST /mcp (Bearer MCP_AUTH_TOKEN when configured); ' +
        'payloads are metadata-only\n\n',
    );

    // Resume point: Last-Event-ID header or ?since=<seq>; null → legacy full replay.
    const since = parseResumeSequence(req);

    // Per-connection teardown state. A holder object keeps the hoisted
    // cleanup/write helpers free of use-before-declaration ordering hazards.
    const stream: {
      cleanedUp: boolean;
      heartbeat?: NodeJS.Timeout;
      unsubscribe?: () => void;
    } = { cleanedUp: false };

    // Hoisted function declarations: the live sink, heartbeat, and disconnect
    // handlers all close over these.
    function cleanupClient(): void {
      if (stream.cleanedUp) return;
      stream.cleanedUp = true;
      if (stream.heartbeat) clearInterval(stream.heartbeat);
      try {
        stream.unsubscribe?.();
      } catch (error) {
        logger.warn('Failed to unsubscribe /events client:', error);
      }
      activeClients = Math.max(0, activeClients - 1);
      maybeDetachRecorder();
    }

    function writeFrame(frame: string): void {
      if (stream.cleanedUp) return;
      try {
        res.write(frame);
      } catch (error) {
        logger.debug?.('Failed to write /events frame:', error);
        cleanupClient();
      }
    }

    // Register the live sink BEFORE flushing the replay buffer. This whole
    // setup block is synchronous (the bus cannot emit mid-setup), so an event
    // is either fully in the buffer or reaches the live sink — never both.
    const sink = (frame: string): void => {
      writeFrame(frame);
    };
    clientSinks.add(sink);
    stream.unsubscribe = () => {
      clientSinks.delete(sink);
    };

    if (since === null) {
      // Legacy behavior: flush the whole bounded buffer.
      for (const recorded of replayBuffer) {
        writeFrame(formatBusEventFrame(recorded.event, recorded.payload, recorded.seq));
      }
    } else {
      // Resume: replay only events newer than the client's last seen seq. If
      // that point predates the oldest buffered frame the intermediate events
      // are gone — send an honest gap notice instead of faking continuity.
      const oldest = replayBuffer[0];
      if (oldest !== undefined && since + 1 < oldest.seq) {
        writeFrame(formatGapFrame(since, oldest.seq));
      }
      for (const recorded of replayBuffer) {
        if (recorded.seq > since) {
          writeFrame(formatBusEventFrame(recorded.event, recorded.payload, recorded.seq));
        }
      }
    }

    stream.heartbeat = setInterval(() => {
      // Colon-prefixed comment frames are ignored by SSE clients but keep the
      // connection (and intermediate proxies) alive.
      writeFrame(':ping\n\n');
    }, heartbeatMs);
    // A heartbeat must never keep the process alive on its own.
    stream.heartbeat.unref?.();

    // Client disconnect (abort/close) and socket errors both terminate the
    // subscription; cleanup is idempotent.
    res.on('close', cleanupClient);
    res.on('error', (error) => {
      logger.debug?.('/events stream error:', error);
      cleanupClient();
    });
  };

  return {
    handleRequest,
    getStats(): EventsEndpointStats {
      return { activeClients, buffered: replayBuffer.length, lastSeq };
    },
  };
}
