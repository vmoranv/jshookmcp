import { describe, expect, it } from 'vitest';
import { WebhookServerImpl } from '@server/webhook/WebhookServer.impl';

describe('WebhookServerImpl coverage', () => {
  it('covers basic getters and registration', () => {
    const server = new WebhookServerImpl({ port: 8080 });
    expect(server.getPort()).toBe(8080);
    expect(server.isRunning()).toBe(false);

    const stats = server.getStats();
    expect(stats.eventsRegistered).toBe(0);
    expect(stats.webhooksSent).toBe(0);

    const id = server.registerEndpoint({ path: '/api/webhook' });
    expect(typeof id).toBe('string');

    const endpoints = server.listEndpoints();
    expect(endpoints.length).toBe(1);
    expect(endpoints[0]?.path).toBe('/api/webhook');

    server.removeEndpoint(id);
    expect(server.listEndpoints().length).toBe(0);

    expect(() => server.removeEndpoint('invalid-ep')).toThrow('Endpoint invalid-ep not found');

    server.registerEvent('tool_called', () => {
      // noop
    });
    expect(server.getStats().eventsRegistered).toBe(1);
  });
});
