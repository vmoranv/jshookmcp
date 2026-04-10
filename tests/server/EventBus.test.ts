import { describe, it, expect, vi } from 'vitest';
import { EventBus, createServerEventBus, type ServerEventMap } from '@server/EventBus';

describe('EventBus', () => {
  it('calls listeners when event is emitted', async () => {
    const bus = new EventBus<ServerEventMap>();
    const handler = vi.fn();
    bus.on('tool:activated', handler);

    const payload = { toolName: 'test', domain: 'core', timestamp: '2026-01-01' };
    await bus.emit('tool:activated', payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('supports multiple listeners for the same event', async () => {
    const bus = new EventBus<ServerEventMap>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('domain:loaded', h1);
    bus.on('domain:loaded', h2);

    const payload = { domain: 'browser', toolCount: 5, timestamp: '2026-01-01' };
    await bus.emit('domain:loaded', payload);

    expect(h1).toHaveBeenCalledWith(payload);
    expect(h2).toHaveBeenCalledWith(payload);
  });

  it('unsubscribes correctly', async () => {
    const bus = new EventBus<ServerEventMap>();
    const handler = vi.fn();
    const unsub = bus.on('tool:deactivated', handler);

    unsub();
    await bus.emit('tool:deactivated', { toolName: 'x', domain: 'y', timestamp: '' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('once listener fires only once', async () => {
    const bus = new EventBus<ServerEventMap>();
    const handler = vi.fn();
    bus.once('extension:loaded', handler);

    const payload = { pluginId: 'p1', toolCount: 2, source: 'test.js', timestamp: '' };
    await bus.emit('extension:loaded', payload);
    await bus.emit('extension:loaded', payload);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('wildcard listener receives all events', async () => {
    const bus = new EventBus<ServerEventMap>();
    const handler = vi.fn();
    bus.onAny(handler);

    await bus.emit('tool:activated', { toolName: 'a', domain: 'b', timestamp: '' });
    await bus.emit('domain:loaded', { domain: 'x', toolCount: 1, timestamp: '' });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ event: 'tool:activated' }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ event: 'domain:loaded' }));
  });

  it('swallows listener errors without breaking other listeners', async () => {
    const bus = new EventBus<ServerEventMap>();
    const errorHandler = vi.fn(() => {
      throw new Error('boom');
    });
    const goodHandler = vi.fn();
    bus.on('tool:activated', errorHandler);
    bus.on('tool:activated', goodHandler);

    await bus.emit('tool:activated', { toolName: 'a', domain: 'b', timestamp: '' });

    expect(errorHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  it('removeAllListeners clears specific event', async () => {
    const bus = new EventBus<ServerEventMap>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('tool:activated', h1);
    bus.on('domain:loaded', h2);

    bus.removeAllListeners('tool:activated');
    await bus.emit('tool:activated', { toolName: 'a', domain: 'b', timestamp: '' });
    await bus.emit('domain:loaded', { domain: 'x', toolCount: 1, timestamp: '' });

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });

  it('removeAllListeners with no args clears everything', () => {
    const bus = new EventBus<ServerEventMap>();
    bus.on('tool:activated', vi.fn());
    bus.on('domain:loaded', vi.fn());
    bus.onAny(vi.fn());

    bus.removeAllListeners();

    expect(bus.listenerCount('tool:activated')).toBe(0);
    expect(bus.listenerCount('domain:loaded')).toBe(0);
  });

  it('listenerCount returns correct count', () => {
    const bus = new EventBus<ServerEventMap>();
    expect(bus.listenerCount('tool:activated')).toBe(0);

    bus.on('tool:activated', vi.fn());
    bus.on('tool:activated', vi.fn());
    expect(bus.listenerCount('tool:activated')).toBe(2);
  });

  it('createServerEventBus returns a typed EventBus', () => {
    const bus = createServerEventBus();
    expect(bus).toBeInstanceOf(EventBus);
  });
});

import { createProgressDebouncer } from '@server/EventBus';

describe('createProgressDebouncer', () => {
  it('throttles progress emits according to debounceMs', () => {
    const bus = createServerEventBus();
    const emitSpy = vi.spyOn(bus, 'emit').mockImplementation(() => Promise.resolve());
    vi.useFakeTimers();

    const onProgress = createProgressDebouncer(bus, 'test-token', 500);

    onProgress(10, 100);
    expect(emitSpy).toHaveBeenCalledTimes(1);

    // Within 500ms -> should not emit
    vi.advanceTimersByTime(200);
    onProgress(20, 100);
    expect(emitSpy).toHaveBeenCalledTimes(1);

    // After 500ms -> should emit
    vi.advanceTimersByTime(300);
    onProgress(30, 100);
    expect(emitSpy).toHaveBeenCalledTimes(2);

    // End condition (progress === total) -> should emit regardless of throttle
    onProgress(100, 100);
    expect(emitSpy).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});
