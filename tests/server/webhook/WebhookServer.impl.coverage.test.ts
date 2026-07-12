import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { WebhookServerImpl } from '@server/webhook/WebhookServer.impl';

async function startServer(server: WebhookServerImpl): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    server.start();
    const httpServer = (server as any).server as import('node:http').Server;
    if (!httpServer.listening) {
      await once(httpServer, 'listening');
    }
    const port = ((httpServer.address() as AddressInfo | null)?.port ?? 0) as number;
    if (port > 0 && !isFetchBlockedPort(port)) {
      return port;
    }
    await server.stop();
  }
  throw new Error('Unable to allocate a fetch-safe webhook test port');
}

function isFetchBlockedPort(port: number): boolean {
  if (port >= 6665 && port <= 6669) return true;
  return new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
    103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
    512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
    995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6697, 10080,
  ]).has(port);
}

describe('WebhookServerImpl coverage', () => {
  it('uses default port when not specified', () => {
    const server = new WebhookServerImpl();
    expect(server.getPort()).toBe(18789);
  });

  it('registers and lists endpoints with default method', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    const id = server.registerEndpoint({ path: '/hook' });
    const endpoints = server.listEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toEqual({ id, path: '/hook', method: 'POST', secret: undefined });
  });

  it('registers endpoint with GET method and secret', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    server.registerEndpoint({ path: '/hook', method: 'GET', secret: 'abc123' });
    const endpoints = server.listEndpoints();
    expect(endpoints[0]?.method).toBe('GET');
    expect(endpoints[0]?.secret).toBe('abc123');
  });

  it('removes endpoint and emits event', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    const listener = vi.fn();
    server.on('endpointRemoved', listener);
    const id = server.registerEndpoint({ path: '/hook' });
    server.removeEndpoint(id);
    expect(listener).toHaveBeenCalledWith(id);
    expect(server.listEndpoints()).toHaveLength(0);
  });

  it('throws when removing non-existent endpoint', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    expect(() => server.removeEndpoint('nope')).toThrow('Endpoint nope not found');
  });

  it('emits endpointRegistered on register', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    const listener = vi.fn();
    server.on('endpointRegistered', listener);
    server.registerEndpoint({ path: '/hook' });
    expect(listener).toHaveBeenCalled();
  });

  it('registers multiple event handlers', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    server.registerEvent('tool_called', handler1);
    server.registerEvent('tool_called', handler2);
    server.registerEvent('domain_activated', vi.fn());
    expect(server.getStats().eventsRegistered).toBe(3);
  });

  it('registers all valid event types', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    const events = [
      'tool_called',
      'domain_activated',
      'evidence_added',
      'workflow_completed',
    ] as const;
    for (const event of events) {
      server.registerEvent(event, vi.fn());
    }
    expect(server.getStats().eventsRegistered).toBe(4);
  });

  it('start throws when already started', () => {
    const server = new WebhookServerImpl({ port: 0 });
    const listener = vi.fn();
    server.on('started', listener);
    server.start();
    expect(listener).toHaveBeenCalled();
    expect(server.isRunning()).toBe(true);

    expect(() => server.start()).toThrow('Webhook server already started');

    // Cleanup
    return server.stop();
  });

  it('stop is no-op when not started', async () => {
    const server = new WebhookServerImpl({ port: 8080 });
    await server.stop();
    expect(server.isRunning()).toBe(false);
  });

  it('stop emits stopped event', async () => {
    const server = new WebhookServerImpl({ port: 0 });
    const listener = vi.fn();
    server.on('stopped', listener);
    server.start();
    await server.stop();
    expect(listener).toHaveBeenCalled();
    expect(server.isRunning()).toBe(false);
  });

  it('propagates close callback failures during stop', async () => {
    const server = new WebhookServerImpl({ port: 8080 });
    (server as any).server = {
      close: (callback: (error?: Error | null) => void) => {
        callback(new Error('close failed'));
      },
    };

    await expect(server.stop()).rejects.toThrow('close failed');
    expect(server.isRunning()).toBe(false);
  });

  it('listEndpoints returns copies', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    server.registerEndpoint({ path: '/hook' });
    const list1 = server.listEndpoints();
    const list2 = server.listEndpoints();
    expect(list1).not.toBe(list2);
    expect(list1).toEqual(list2);
  });

  it('getStats returns copies', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    const stats1 = server.getStats();
    const stats2 = server.getStats();
    expect(stats1).not.toBe(stats2);
  });

  it('handles empty request bodies with default method and url fallbacks', async () => {
    const server = new WebhookServerImpl({ port: 8080 });
    server.registerEndpoint({ path: '/', method: 'GET' });

    const request = new EventEmitter() as any;
    request.method = undefined;
    request.url = undefined;
    request.headers = {};
    request.setEncoding = vi.fn();

    const response = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as any;

    const pending = (server as any).handleRequest(request, response) as Promise<void>;
    request.emit('end');
    await pending;

    expect(request.setEncoding).toHaveBeenCalledWith('utf8');
    expect(response.setHeader).toHaveBeenCalledWith('content-type', 'application/json');
    expect(response.end).toHaveBeenCalledWith(JSON.stringify({ ok: true, endpointId: 'ep-1' }));
  });

  it('rejects when request streaming fails before completion', async () => {
    const server = new WebhookServerImpl({ port: 8080 });
    server.registerEndpoint({ path: '/hook' });

    const request = new EventEmitter() as any;
    request.method = 'POST';
    request.url = '/hook';
    request.headers = {};
    request.setEncoding = vi.fn();

    const response = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as any;

    const pending = (server as any).handleRequest(request, response) as Promise<void>;
    request.emit('error', new Error('stream failed'));

    await expect(pending).rejects.toThrow('stream failed');
    expect(response.end).not.toHaveBeenCalled();
  });

  it('returns not found for unknown routes', async () => {
    const server = new WebhookServerImpl({ port: 0 });
    const port = await startServer(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/missing`, { method: 'POST' });
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe('not found');
    } finally {
      await server.stop();
    }
  });

  it('rejects webhook requests with an invalid HMAC signature', async () => {
    const server = new WebhookServerImpl({ port: 0 });
    server.registerEndpoint({ path: '/secure', secret: 'expected-secret' });
    const port = await startServer(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/secure`, {
        method: 'POST',
        headers: { 'x-webhook-signature': 'deadbeef' },
        body: '{}',
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: 'invalid signature' });
    } finally {
      await server.stop();
    }
  });

  it('rejects webhook requests missing the signature header', async () => {
    const server = new WebhookServerImpl({ port: 0 });
    server.registerEndpoint({ path: '/secure', secret: 's3cret' });
    const port = await startServer(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/secure`, {
        method: 'POST',
        body: '{}',
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: 'missing signature header' });
    } finally {
      await server.stop();
    }
  });

  it('accepts HMAC signature with sha256= prefix', async () => {
    const { createHmac } = await import('node:crypto');
    const queue = { enqueue: vi.fn() };
    const server = new WebhookServerImpl({ port: 0, commandQueue: queue as any });
    server.registerEndpoint({ path: '/hook', secret: 's3cret' });
    const port = await startServer(server);

    try {
      const body = '{"event":"tool_called"}';
      const sig = createHmac('sha256', 's3cret').update(body, 'utf8').digest('hex');
      const response = await fetch(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': `sha256=${sig}`,
        },
        body,
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true });
    } finally {
      await server.stop();
    }
  });

  it('rejects expired timestamp even with valid signature', async () => {
    const { createHmac } = await import('node:crypto');
    const server = new WebhookServerImpl({ port: 0 });
    server.registerEndpoint({ path: '/timed', secret: 's3cret' });
    const port = await startServer(server);

    try {
      const body = '{}';
      const sig = createHmac('sha256', 's3cret').update(body, 'utf8').digest('hex');
      const oldTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 min ago
      const response = await fetch(`http://127.0.0.1:${port}/timed`, {
        method: 'POST',
        headers: {
          'x-webhook-signature': sig,
          'x-webhook-timestamp': oldTimestamp,
        },
        body,
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: 'timestamp expired' });
    } finally {
      await server.stop();
    }
  });

  it('accepts valid signature with recent timestamp', async () => {
    const { createHmac } = await import('node:crypto');
    const queue = { enqueue: vi.fn() };
    const server = new WebhookServerImpl({ port: 0, commandQueue: queue as any });
    server.registerEndpoint({ path: '/timed', secret: 's3cret' });
    const port = await startServer(server);

    try {
      const body = '{"event":"tool_called"}';
      const sig = createHmac('sha256', 's3cret').update(body, 'utf8').digest('hex');
      const now = String(Date.now());
      const response = await fetch(`http://127.0.0.1:${port}/timed`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': sig,
          'x-webhook-timestamp': now,
        },
        body,
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true });
    } finally {
      await server.stop();
    }
  });

  it('skips HMAC verification when endpoint has no secret', async () => {
    const queue = { enqueue: vi.fn() };
    const server = new WebhookServerImpl({ port: 0, commandQueue: queue as any });
    server.registerEndpoint({ path: '/open' });
    const port = await startServer(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"event":"tool_called"}',
      });
      expect(response.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('queues raw payloads and ignores unknown event names', async () => {
    const queue = { enqueue: vi.fn() };
    const handler = vi.fn();
    const server = new WebhookServerImpl({ port: 0, commandQueue: queue as any });
    server.registerEndpoint({ path: '/hook' });
    server.registerEvent('tool_called', handler);
    const port = await startServer(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'not-json',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toMatchObject({ ok: true, endpointId: 'ep-1' });
      expect(queue.enqueue).toHaveBeenCalledWith({
        endpointId: 'ep-1',
        payload: { rawBody: 'not-json' },
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });

  it('invokes registered event handlers with valid HMAC signature', async () => {
    const { createHmac } = await import('node:crypto');
    const queue = { enqueue: vi.fn() };
    const handler = vi.fn();
    const server = new WebhookServerImpl({ port: 0, commandQueue: queue as any });
    server.registerEndpoint({ path: '/events', secret: 'top-secret' });
    server.registerEvent('tool_called', handler);
    const port = await startServer(server);
    const originalFetch = global.fetch;

    try {
      const body = JSON.stringify({ event: 'tool_called', payload: { id: 1 } });
      const signature = createHmac('sha256', 'top-secret').update(body, 'utf8').digest('hex');
      const response = await originalFetch(`http://127.0.0.1:${port}/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
        body,
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, endpointId: 'ep-1' });
      expect(queue.enqueue).toHaveBeenCalledWith({
        endpointId: 'ep-1',
        payload: { event: 'tool_called', payload: { id: 1 } },
      });
      expect(handler).toHaveBeenCalledWith({ event: 'tool_called', payload: { id: 1 } });

      global.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
      await server.sendWebhook('http://127.0.0.1:43210/hook', 'tool_called', { value: 1 });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:43210/hook',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'tool_called', payload: { value: 1 } }),
        }),
      );
      const stats = server.getStats();
      expect(stats.webhooksSent).toBe(1);
      expect(stats.lastSentAt).toBeTruthy();
    } finally {
      global.fetch = originalFetch;
      await server.stop();
    }
  });

  it('covers remaining webhook event branches without registered listeners', async () => {
    const server = new WebhookServerImpl({ port: 8080 });
    const domainActivated = vi.fn();
    const evidenceAdded = vi.fn();
    const workflowCompleted = vi.fn();

    server.registerEvent('domain_activated', domainActivated);
    server.registerEvent('evidence_added', evidenceAdded);
    server.registerEvent('workflow_completed', workflowCompleted);

    await expect(
      (server as any).invokeEventHandlers('domain_activated', { event: 'domain_activated' }),
    ).resolves.toBeUndefined();
    await expect(
      (server as any).invokeEventHandlers('evidence_added', { event: 'evidence_added' }),
    ).resolves.toBeUndefined();
    await expect(
      (server as any).invokeEventHandlers('workflow_completed', {
        event: 'workflow_completed',
      }),
    ).resolves.toBeUndefined();
    await expect(
      (server as any).invokeEventHandlers('tool_called', { event: 'tool_called' }),
    ).resolves.toBeUndefined();
    await expect(
      (server as any).invokeEventHandlers('not_a_webhook_event', {
        event: 'not_a_webhook_event',
      }),
    ).resolves.toBeUndefined();

    expect(domainActivated).toHaveBeenCalledWith({ event: 'domain_activated' });
    expect(evidenceAdded).toHaveBeenCalledWith({ event: 'evidence_added' });
    expect(workflowCompleted).toHaveBeenCalledWith({ event: 'workflow_completed' });
  });
});
