import { timingSafeEqual } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import {
  WEBHOOK_PORT,
  WEBHOOK_QUEUE_MAX_RETRIES,
  WEBHOOK_QUEUE_MAX_SIZE,
  WEBHOOK_QUEUE_RETRY_DELAY_MS,
} from '@src/constants';
import { readEnvBoolean, readEnvString } from '@src/config/environment';
import { CommandQueueImpl } from './CommandQueue.impl.js';

export type WebhookEvent =
  | 'tool_called'
  | 'domain_activated'
  | 'evidence_added'
  | 'workflow_completed';

interface RegisteredEndpointInput {
  path: string;
  method?: 'GET' | 'POST';
  secret?: string;
}

interface RegisteredEndpoint extends RegisteredEndpointInput {
  id: string;
}

interface WebhookServerOptions {
  port?: number;
  /**
   * Interface to bind. Defaults to 127.0.0.1: this endpoint is an inbound
   * command surface, and binding it to a wildcard address exposes an
   * unauthenticated-by-default listener to the network (DNS rebinding reaches
   * loopback too, so the secret check below still applies).
   */
  host?: string;
  commandQueue?: CommandQueueImpl;
}

interface WebhookStats {
  eventsRegistered: number;
  webhooksSent: number;
  lastSentAt?: string;
}

type WebhookHandler = (payload: unknown) => void | Promise<void>;

function isWebhookEvent(value: string): value is WebhookEvent {
  return (
    value === 'tool_called' ||
    value === 'domain_activated' ||
    value === 'evidence_added' ||
    value === 'workflow_completed'
  );
}

function parseJsonBody(rawBody: string): unknown {
  if (rawBody.length === 0) {
    return {};
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    return { rawBody };
  }
}

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes
/** Hard cap on a webhook request body (webhooks carry small JSON payloads). */
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
/** Socket read deadlines so a stalled client cannot hold a connection open. */
const WEBHOOK_REQUEST_TIMEOUT_MS = 30_000;
const WEBHOOK_HEADERS_TIMEOUT_MS = 15_000;

/**
 * Verify an HMAC-SHA256 webhook signature.
 *
 * Supports two header styles:
 * 1. Raw hex digest: `X-Webhook-Signature: <hex>`
 * 2. GitHub-style prefix: `X-Webhook-Signature: sha256=<hex>`
 *
 * Anti-replay: `X-Webhook-Timestamp` is REQUIRED and is part of the signed
 * material (`<timestamp>.<rawBody>`). It must be within ±5 minutes of the
 * server clock. Signing only the body would let a captured request be replayed
 * with a fresh timestamp (or none at all).
 */
function verifySignature(
  rawBody: string,
  signatureHeader: string,
  timestampHeader: string | undefined,
  secret: string,
): { valid: false; error: string } | { valid: true } {
  const provided = signatureHeader.replace(/^sha256=/, '');

  // A secret-protected endpoint requires a timestamp: without one the replay
  // window cannot be enforced at all.
  if (timestampHeader === undefined || timestampHeader.trim().length === 0) {
    return { valid: false, error: 'missing timestamp header' };
  }
  const ts = Number(timestampHeader);
  if (Number.isNaN(ts) || ts <= 0) {
    return { valid: false, error: 'invalid timestamp' };
  }
  if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
    return { valid: false, error: 'timestamp expired' };
  }

  const signedPayload = `${timestampHeader}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  // Constant-time comparison
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return { valid: false, error: 'invalid signature' };
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, error: 'invalid signature' };
  }

  return { valid: true };
}

export class WebhookServerImpl extends EventEmitter {
  private readonly endpoints = new Map<string, RegisteredEndpoint>();
  private readonly eventHandlers = new Map<WebhookEvent, WebhookHandler[]>();
  private readonly port: number;
  private readonly host: string;
  private readonly commandQueue: CommandQueueImpl;
  private readonly stats: WebhookStats = {
    eventsRegistered: 0,
    webhooksSent: 0,
  };

  private server?: http.Server;
  private nextEndpointId = 1;

  constructor(options: WebhookServerOptions = {}) {
    super();
    this.port = typeof options.port === 'number' ? options.port : WEBHOOK_PORT;
    this.host = options.host ?? readEnvString('WEBHOOK_HOST', '127.0.0.1', { trim: true });
    // The queue is owned by the server (created here when not injected), so
    // its lifecycle always matches the server's: stopping the server releases
    // the queue, and any code that enqueues through getCommandQueue() talks to
    // the SAME instance the HTTP handler drains.
    this.commandQueue =
      options.commandQueue ??
      new CommandQueueImpl({
        maxQueueSize: WEBHOOK_QUEUE_MAX_SIZE,
        maxRetries: WEBHOOK_QUEUE_MAX_RETRIES,
        retryDelay: WEBHOOK_QUEUE_RETRY_DELAY_MS,
      });
  }

  /** The command queue the HTTP handler drains — shared with enqueue callers. */
  getCommandQueue(): CommandQueueImpl {
    return this.commandQueue;
  }

  registerEndpoint(config: RegisteredEndpointInput): string {
    const id = `ep-${this.nextEndpointId}`;
    this.nextEndpointId += 1;
    this.endpoints.set(id, {
      id,
      path: config.path,
      method: config.method ?? 'POST',
      secret: config.secret,
    });
    this.emit('endpointRegistered', id);
    return id;
  }

  removeEndpoint(id: string): void {
    const existed = this.endpoints.delete(id);
    if (!existed) {
      throw new Error(`Endpoint ${id} not found`);
    }
    this.emit('endpointRemoved', id);
  }

  listEndpoints(): RegisteredEndpoint[] {
    return [...this.endpoints.values()].map((endpoint) => ({ ...endpoint }));
  }

  getPort(): number {
    return this.port;
  }

  isRunning(): boolean {
    return this.server !== undefined;
  }

  registerEvent(event: WebhookEvent, handler: WebhookHandler): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
    this.stats.eventsRegistered += 1;
  }

  start(): void {
    if (this.server) {
      throw new Error('Webhook server already started');
    }

    this.server = http.createServer((request, response) => {
      // Fire-and-forget used to turn any rejection (body stream error, a full
      // queue throwing, a rejecting event handler) into an unhandled rejection
      // with the client left hanging. Always finish the response.
      this.handleRequest(request, response).catch((error: unknown) => {
        this.emit('requestError', error);
        if (!response.writableEnded) {
          if (!response.headersSent) {
            response.statusCode = 500;
            response.setHeader('content-type', 'application/json');
          }
          response.end(JSON.stringify({ error: 'internal error' }));
        }
      });
    });
    // An unhandled 'error' event on an http.Server (EADDRINUSE, EACCES on a
    // privileged port) crashes the process. Surface it instead.
    this.server.once('error', (error) => {
      this.server = undefined;
      this.emit('serverError', error);
    });
    this.server.requestTimeout = WEBHOOK_REQUEST_TIMEOUT_MS;
    this.server.headersTimeout = WEBHOOK_HEADERS_TIMEOUT_MS;
    // `listen()` is asynchronous: `started` must fire once the socket is bound.
    this.server.listen(this.port, this.host, () => {
      this.emit('started', this.port);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    // `listen()` is asynchronous, so stop() can legitimately race a bind that
    // has been issued but not completed (start(); stop() in the same tick).
    // Closing a not-yet-listening server yields ERR_SERVER_NOT_RUNNING and
    // leaves the pending socket alive, so wait for the bind to settle first.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error);
          return;
        }
        resolve();
      };
      const guard = setTimeout(() => finish(), 2_000);
      guard.unref();
      if (server.listening || typeof server.once !== 'function') {
        server.close(finish);
        return;
      }
      server.once('listening', () => {
        server.close(finish);
      });
      server.once('error', () => finish());
    });
    this.emit('stopped');
  }

  async sendWebhook(url: string, event: WebhookEvent, payload: unknown): Promise<void> {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ event, payload }),
    });

    this.stats.webhooksSent += 1;
    this.stats.lastSentAt = new Date().toISOString();
  }

  getStats(): WebhookStats {
    return {
      ...this.stats,
    };
  }

  private async handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const method = request.method ?? 'GET';
    const url = request.url ?? '/';

    const endpoint = [...this.endpoints.values()].find(
      (item) => item.path === url && item.method === method,
    );

    if (!endpoint) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    // Fail closed. An endpoint without a declared secret cannot authenticate
    // its caller, so it must not be reachable unless the operator explicitly
    // opts out for local experiments.
    if (!endpoint.secret && !readEnvBoolean('WEBHOOK_ALLOW_UNAUTHENTICATED', false)) {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          error:
            'endpoint has no secret; set WEBHOOK_ALLOW_UNAUTHENTICATED=1 only for local testing',
        }),
      );
      return;
    }

    // Read body before HMAC verification (signature covers the raw body).
    // Bound the buffered size: an unbounded read lets one client exhaust the
    // heap.
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
      response.statusCode = 413;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'payload too large' }));
      request.destroy();
      return;
    }

    const chunks: string[] = [];
    let totalBytes = 0;
    let tooLarge = false;
    await new Promise<void>((resolve, reject) => {
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        if (tooLarge) return;
        totalBytes += Buffer.byteLength(chunk as string, 'utf8');
        if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
          tooLarge = true;
          request.pause();
          resolve();
          return;
        }
        chunks.push(chunk as string);
      });
      request.on('end', () => {
        resolve();
      });
      request.on('error', (error) => {
        reject(error);
      });
    });
    if (tooLarge) {
      response.statusCode = 413;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'payload too large' }));
      request.destroy();
      return;
    }

    const rawBody = chunks.join('');

    // HMAC-SHA256 signature verification with optional anti-replay
    if (endpoint.secret) {
      const signature = request.headers['x-webhook-signature'];
      if (!signature || typeof signature !== 'string') {
        response.statusCode = 401;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ error: 'missing signature header' }));
        return;
      }

      const timestamp = request.headers['x-webhook-timestamp'];
      const result = verifySignature(
        rawBody,
        signature,
        typeof timestamp === 'string' ? timestamp : undefined,
        endpoint.secret,
      );
      if (!result.valid) {
        response.statusCode = 401;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ error: result.error }));
        return;
      }
    }

    const payload = parseJsonBody(rawBody);
    if (this.commandQueue) {
      this.commandQueue.enqueue({
        endpointId: endpoint.id,
        payload,
      });
    }

    if (
      payload &&
      typeof payload === 'object' &&
      'event' in payload &&
      typeof payload.event === 'string'
    ) {
      await this.invokeEventHandlers(payload.event, payload);
    }

    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        ok: true,
        endpointId: endpoint.id,
      }),
    );
  }

  private async invokeEventHandlers(eventName: string, payload: unknown): Promise<void> {
    if (!isWebhookEvent(eventName)) {
      return;
    }
    const handlers = this.eventHandlers.get(eventName) ?? [];
    for (const handler of handlers) {
      await Promise.resolve(handler(payload));
    }
  }
}

export class WebhookServer extends WebhookServerImpl {}
