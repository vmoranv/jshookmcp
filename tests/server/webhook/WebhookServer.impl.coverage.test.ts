import { describe, expect, it, vi } from 'vitest';
import { WebhookServerImpl } from '@server/webhook/WebhookServer.impl';

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
});
