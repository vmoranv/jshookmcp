import { timingSafeEqual } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
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

/**
 * Verify an HMAC-SHA256 webhook signature.
 *
 * Supports two header styles:
 * 1. Raw hex digest: `X-Webhook-Signature: <hex>`
 * 2. GitHub-style prefix: `X-Webhook-Signature: sha256=<hex>`
 *
 * Anti-replay: when `X-Webhook-Timestamp` is present the timestamp must
 * be within ±5 minutes of the server clock.
 */
function verifySignature(
  rawBody: string,
  signatureHeader: string,
  timestampHeader: string | undefined,
  secret: string,
): { valid: false; error: string } | { valid: true } {
  const provided = signatureHeader.replace(/^sha256=/, '');

  // Anti-replay guard
  if (timestampHeader !== undefined) {
    const ts = Number(timestampHeader);
    if (Number.isNaN(ts) || ts <= 0) {
      return { valid: false, error: 'invalid timestamp' };
    }
    if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
      return { valid: false, error: 'timestamp expired' };
    }
  }

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

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
  private readonly commandQueue?: CommandQueueImpl;
  private readonly stats: WebhookStats = {
    eventsRegistered: 0,
    webhooksSent: 0,
  };

  private server?: http.Server;
  private nextEndpointId = 1;

  constructor(options: WebhookServerOptions = {}) {
    super();
    this.port = typeof options.port === 'number' ? options.port : 18_789;
    this.commandQueue = options.commandQueue;
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
      void this.handleRequest(request, response);
    });
    this.server.listen(this.port);
    this.emit('started', this.port);
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
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

    // Read body before HMAC verification (signature covers the raw body)
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        resolve();
      });
      request.on('error', (error) => {
        reject(error);
      });
    });

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
