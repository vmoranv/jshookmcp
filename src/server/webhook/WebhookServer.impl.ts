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

    if (endpoint.secret) {
      const secret = request.headers['x-webhook-secret'];
      if (secret !== endpoint.secret) {
        response.statusCode = 401;
        response.end('unauthorized');
        return;
      }
    }

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

    const payload = parseJsonBody(chunks.join(''));
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
