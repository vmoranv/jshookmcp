/**
 * SSE (Server-Sent Events) stream handler for real-time progress updates.
 *
 * Provides a streaming endpoint for task progress events via text/event-stream.
 */

import type { ServerResponse, IncomingMessage } from 'node:http';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { logger } from '@utils/logger';

export interface SseStreamOptions {
  /** Session ID to filter events (optional - if not set, streams all events) */
  sessionId?: string;
  /** Heartbeat interval in ms to keep connection alive (default: 30000) */
  heartbeatMs?: number;
}

export class SseStream {
  private readonly eventBus: EventBus<ServerEventMap>;
  private readonly options: SseStreamOptions;
  private res: ServerResponse | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private closed = false;

  constructor(eventBus: EventBus<ServerEventMap>, options: SseStreamOptions = {}) {
    this.eventBus = eventBus;
    this.options = {
      heartbeatMs: options.heartbeatMs ?? 30_000,
      sessionId: options.sessionId,
    };
  }

  /**
   * Start streaming SSE events to the response.
   */
  start(res: ServerResponse): void {
    if (this.res) {
      logger.warn('SseStream already started');
      return;
    }

    this.res = res;
    this.closed = false;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    this.sendEvent('connected', {
      timestamp: new Date().toISOString(),
      sessionId: this.options.sessionId,
    });

    // Subscribe to task:update events
    this.unsubscribe = this.eventBus.on('task:update', (payload) => {
      // Filter by sessionId if specified
      if (this.options.sessionId && payload.sessionId !== this.options.sessionId) {
        return;
      }
      this.sendEvent('task:update', payload);
    });

    // Start heartbeat to keep connection alive
    this.startHeartbeat();

    // Handle client disconnect
    res.on('close', () => {
      this.close();
    });

    res.on('error', (err) => {
      logger.warn('SSE stream error:', err);
      this.close();
    });
  }

  /**
   * Send an SSE event.
   */
  sendEvent(event: string, data: unknown): void {
    if (!this.res || this.closed) {
      return;
    }

    const eventData = JSON.stringify(data);
    const lines = `event: ${event}\ndata: ${eventData}\n\n`;

    try {
      this.res.write(lines);
    } catch (err) {
      logger.warn('Failed to write SSE event:', err);
      this.close();
    }
  }

  /**
   * Send a raw message (useful for custom formatting).
   */
  sendRaw(message: string): void {
    if (!this.res || this.closed) {
      return;
    }

    try {
      this.res.write(`${message}\n\n`);
    } catch (err) {
      logger.warn('Failed to write SSE message:', err);
      this.close();
    }
  }

  /**
   * Close the SSE stream.
   */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Unsubscribe from events
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // End response
    if (this.res && !this.res.writableEnded) {
      try {
        this.res.end();
      } catch {
        // Ignore close errors
      }
    }

    this.res = null;
    logger.debug('SSE stream closed');
  }

  /**
   * Start heartbeat timer to keep connection alive.
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.closed && this.res) {
        // Send comment (colon-prefixed lines are ignored by SSE clients)
        try {
          this.res.write(`: heartbeat\n\n`);
        } catch {
          this.close();
        }
      }
    }, this.options.heartbeatMs);
  }
}

// ── HTTP Handler ──

/**
 * Create SSE handler for /progress/:sessionId endpoint.
 */
export function createProgressHandler(
  eventBus: EventBus<ServerEventMap>,
): (req: IncomingMessage, res: ServerResponse, sessionId?: string) => void {
  return (req: IncomingMessage, res: ServerResponse, sessionId?: string) => {
    // CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const stream = new SseStream(eventBus, { sessionId });
    stream.start(res);
  };
}
