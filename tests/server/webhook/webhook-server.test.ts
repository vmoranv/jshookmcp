import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookServer } from '@src/server/webhook/WebhookServer';
import { CommandQueue } from '@src/server/webhook/CommandQueue';

describe('WebhookServer', () => {
  let server: WebhookServer;
  let queue: CommandQueue;

  beforeEach(() => {
    queue = new CommandQueue();
    server = new WebhookServer({ commandQueue: queue });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('registerEndpoint', () => {
    it('should register endpoint and return ID', () => {
      const id = server.registerEndpoint({ path: '/test' });
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should register with custom method and secret', () => {
      const id = server.registerEndpoint({ path: '/secure', method: 'GET', secret: 'my-secret' });
      expect(id).toBeDefined();
      const endpoints = server.listEndpoints();
      const ep = endpoints.find((e) => e.id === id);
      expect(ep).toBeDefined();
      expect(ep?.method).toBe('GET');
      expect(ep?.secret).toBe('my-secret');
    });

    it('should emit endpointRegistered event', () => {
      const events: unknown[] = [];
      server.on('endpointRegistered', (e) => events.push(e));
      server.registerEndpoint({ path: '/test' });
      expect(events).toHaveLength(1);
    });
  });

  describe('removeEndpoint', () => {
    it('should remove endpoint', () => {
      const id = server.registerEndpoint({ path: '/test' });
      server.removeEndpoint(id);
      expect(server.listEndpoints()).toEqual([]);
    });

    it('should emit endpointRemoved event', () => {
      const events: unknown[] = [];
      server.on('endpointRemoved', (e) => events.push(e));
      const id = server.registerEndpoint({ path: '/test' });
      server.removeEndpoint(id);
      expect(events).toHaveLength(1);
      expect(events[0]).toBe(id);
    });

    it('should throw if endpoint not found', () => {
      expect(() => server.removeEndpoint('nonexistent')).toThrow('not found');
    });
  });

  describe('listEndpoints', () => {
    it('should return empty array initially', () => {
      expect(server.listEndpoints()).toEqual([]);
    });

    it('should return registered endpoints', () => {
      server.registerEndpoint({ path: '/a' });
      server.registerEndpoint({ path: '/b' });
      expect(server.listEndpoints()).toHaveLength(2);
    });
  });

  describe('start/stop', () => {
    it('should throw if already started', async () => {
      await server.stop();
      server.start();
      expect(() => server.start()).toThrow('already started');
      await server.stop();
    });

    it('should stop gracefully', async () => {
      server.start();
      await server.stop();
    });

    it('should be idempotent stop', async () => {
      await server.stop();
      await server.stop();
    });

    it('should emit started event', async () => {
      const events: unknown[] = [];
      server.on('started', (e) => events.push(e));
      server.start();
      expect(events).toHaveLength(1);
      await server.stop();
    });

    it('should emit stopped event', async () => {
      const events: unknown[] = [];
      server.on('stopped', () => events.push(true));
      server.start();
      await server.stop();
      expect(events).toHaveLength(1);
    });
  });

  describe('getPort', () => {
    it('should return configured port', () => {
      const s = new WebhookServer({ port: 9999 });
      expect(s.getPort()).toBe(9999);
    });

    it('should return default port', () => {
      expect(server.getPort()).toBe(18789);
    });
  });

  describe('off', () => {
    it('should remove event listener', () => {
      const fn = vi.fn();
      server.on('endpointRegistered', fn);
      server.off('endpointRegistered', fn);
      server.registerEndpoint({ path: '/test' });
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
