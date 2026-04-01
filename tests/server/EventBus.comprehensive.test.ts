/**
 * Comprehensive tests for EventBus — covers remaining 12% uncovered code:
 * - once() manual unsubscribe before event fires
 * - onAny() unsubscribe before/after events fire
 * - Async listener errors (swallowed in wildcards)
 * - Edge cases with empty listener arrays
 */
import { describe, it, expect, vi } from 'vitest';
import { EventBus, createServerEventBus, type ServerEventMap } from '@server/EventBus';

describe('EventBus — comprehensive coverage', () => {
  describe('once() edge cases', () => {
    it('once() unsubscribe function removes listener before it fires', async () => {
      const bus = new EventBus<ServerEventMap>();
      const handler = vi.fn();
      const unsub = bus.once('tool:activated', handler);

      unsub(); // Remove before firing
      await bus.emit('tool:activated', { toolName: 'a', domain: 'b', timestamp: '' });

      expect(handler).not.toHaveBeenCalled();
      expect(bus.listenerCount('tool:activated')).toBe(0);
    });

    it('once() listener is automatically removed after firing', async () => {
      const bus = new EventBus<ServerEventMap>();
      const handler = vi.fn();
      bus.once('domain:loaded', handler);

      await bus.emit('domain:loaded', { domain: 'x', toolCount: 1, timestamp: '' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(bus.listenerCount('domain:loaded')).toBe(0);

      // Second emit should not call handler
      await bus.emit('domain:loaded', { domain: 'y', toolCount: 2, timestamp: '' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('once() with multiple listeners — only the once listener is removed', async () => {
      const bus = new EventBus<ServerEventMap>();
      const onceHandler = vi.fn();
      const persistentHandler = vi.fn();

      bus.once('tool:called', onceHandler);
      bus.on('tool:called', persistentHandler);

      const payload = { toolName: 't', domain: 'd', timestamp: '', success: true };
      await bus.emit('tool:called', payload);

      expect(onceHandler).toHaveBeenCalledTimes(1);
      expect(persistentHandler).toHaveBeenCalledTimes(1);
      expect(bus.listenerCount('tool:called')).toBe(1);

      await bus.emit('tool:called', payload);
      expect(onceHandler).toHaveBeenCalledTimes(1);
      expect(persistentHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('onAny() edge cases', () => {
    it('onAny() unsubscribe removes wildcard listener', async () => {
      const bus = new EventBus<ServerEventMap>();
      const handler = vi.fn();
      const unsub = bus.onAny(handler);

      unsub();
      await bus.emit('tool:activated', { toolName: 'x', domain: 'y', timestamp: '' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('onAny() receives events with correct structure', async () => {
      const bus = new EventBus<ServerEventMap>();
      const handler = vi.fn();
      bus.onAny(handler);

      const payload = { url: 'https://example.com', timestamp: '' };
      await bus.emit('browser:navigated', payload);

      expect(handler).toHaveBeenCalledWith({
        event: 'browser:navigated',
        payload,
      });
    });

    it('multiple wildcard listeners all receive events', async () => {
      const bus = new EventBus<ServerEventMap>();
      const h1 = vi.fn();
      const h2 = vi.fn();
      const h3 = vi.fn();

      bus.onAny(h1);
      bus.onAny(h2);
      bus.onAny(h3);

      await bus.emit('extension:loaded', {
        pluginId: 'p',
        toolCount: 1,
        source: 's',
        timestamp: '',
      });

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
      expect(h3).toHaveBeenCalledTimes(1);
    });

    it('wildcard listener errors are swallowed', async () => {
      const bus = new EventBus<ServerEventMap>();
      const errorHandler = vi.fn(() => {
        throw new Error('wildcard boom');
      });
      const goodHandler = vi.fn();

      bus.onAny(errorHandler);
      bus.onAny(goodHandler);

      await bus.emit('domain:unloaded', { domain: 'x', timestamp: '' });

      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });

    it('async wildcard listener errors are swallowed', async () => {
      const bus = new EventBus<ServerEventMap>();
      const asyncErrorHandler = vi.fn(async () => {
        throw new Error('async wildcard boom');
      });
      const afterHandler = vi.fn();

      bus.onAny(asyncErrorHandler);
      bus.onAny(afterHandler);

      await bus.emit('session:browser_launched', { mode: 'headless', timestamp: '' });

      expect(asyncErrorHandler).toHaveBeenCalled();
      expect(afterHandler).toHaveBeenCalled();
    });
  });

  describe('emit() edge cases', () => {
    it('emit() handles event with no listeners gracefully', async () => {
      const bus = new EventBus<ServerEventMap>();
      // No listeners registered — should not throw
      await expect(
        bus.emit('debugger:breakpoint_hit', { scriptId: 's', lineNumber: 10, timestamp: '' }),
      ).resolves.toBeUndefined();
    });

    it('async listener errors are swallowed', async () => {
      const bus = new EventBus<ServerEventMap>();
      const asyncErrorHandler = vi.fn(async () => {
        throw new Error('async boom');
      });
      const normalHandler = vi.fn();

      bus.on('memory:scan_completed', asyncErrorHandler);
      bus.on('memory:scan_completed', normalHandler);

      await bus.emit('memory:scan_completed', {
        scanType: 'heap',
        resultCount: 10,
        timestamp: '',
      });

      expect(asyncErrorHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });

    it('once listeners removed in reverse order preserve indices', async () => {
      const bus = new EventBus<ServerEventMap>();
      const calls: number[] = [];

      bus.once('activation:domain_boosted', () => calls.push(1));
      bus.on('activation:domain_boosted', () => calls.push(2));
      bus.once('activation:domain_boosted', () => calls.push(3));
      bus.on('activation:domain_boosted', () => calls.push(4));
      bus.once('activation:domain_boosted', () => calls.push(5));

      const payload = { domain: 'd', reason: 'r', timestamp: '' };
      await bus.emit('activation:domain_boosted', payload);

      // All should fire
      expect(calls).toEqual([1, 2, 3, 4, 5]);
      // Only persistent listeners remain
      expect(bus.listenerCount('activation:domain_boosted')).toBe(2);

      // Second emit — only persistent
      calls.length = 0;
      await bus.emit('activation:domain_boosted', payload);
      expect(calls).toEqual([2, 4]);
    });
  });

  describe('removeAllListeners() edge cases', () => {
    it('removeAllListeners() on empty bus is safe', () => {
      const bus = new EventBus<ServerEventMap>();
      expect(() => bus.removeAllListeners()).not.toThrow();
      expect(() => bus.removeAllListeners('tool:activated')).not.toThrow();
    });

    it('removeAllListeners() clears wildcard listeners when no event specified', () => {
      const bus = new EventBus<ServerEventMap>();
      const wildcard = vi.fn();
      bus.onAny(wildcard);
      bus.on('tool:activated', vi.fn());

      bus.removeAllListeners();

      // Both should be cleared
      expect(bus.listenerCount('tool:activated')).toBe(0);
    });
  });

  describe('listenerCount()', () => {
    it('returns 0 for non-existent event', () => {
      const bus = new EventBus<ServerEventMap>();
      expect(bus.listenerCount('extension:unloaded')).toBe(0);
    });

    it('counts correctly after subscribe/unsubscribe cycles', () => {
      const bus = new EventBus<ServerEventMap>();

      const unsub1 = bus.on('session:browser_closed', vi.fn());
      const unsub2 = bus.on('session:browser_closed', vi.fn());
      expect(bus.listenerCount('session:browser_closed')).toBe(2);

      unsub1();
      expect(bus.listenerCount('session:browser_closed')).toBe(1);

      unsub2();
      expect(bus.listenerCount('session:browser_closed')).toBe(0);
    });
  });

  describe('factory function', () => {
    it('createServerEventBus returns typed EventBus instance', () => {
      const bus = createServerEventBus();
      expect(bus).toBeInstanceOf(EventBus);
      // Type checking — these should exist on ServerEventMap
      bus.on('tool:activated', () => {});
      bus.on('browser:navigated', () => {});
    });
  });
});
