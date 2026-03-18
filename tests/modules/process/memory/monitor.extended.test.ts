import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MemoryMonitorManager } from '@modules/process/memory/monitor';

describe('MemoryMonitorManager', () => {
  let manager: MemoryMonitorManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new MemoryMonitorManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start returns a unique monitor ID', () => {
    const readFn = vi.fn().mockResolvedValue({ success: true, data: 'AABB' });
    const id = manager.start(100, '0x1000', 4, 1000, readFn);

    expect(id).toMatch(/^monitor_\d+_/);
    manager.stop(id);
  });

  it('calls readMemoryFn on each interval tick', async () => {
    const readFn = vi.fn().mockResolvedValue({ success: true, data: 'AABB' });
    const id = manager.start(100, '0x1000', 4, 500, readFn);

    await vi.advanceTimersByTimeAsync(500);
    expect(readFn).toHaveBeenCalledTimes(1);
    expect(readFn).toHaveBeenCalledWith(100, '0x1000', 4);

    await vi.advanceTimersByTimeAsync(500);
    expect(readFn).toHaveBeenCalledTimes(2);

    manager.stop(id);
  });

  it('invokes onChange when value changes after initial read', async () => {
    const readFn = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: 'AA' })
      .mockResolvedValueOnce({ success: true, data: 'BB' })
      .mockResolvedValueOnce({ success: true, data: 'BB' });

    const onChange = vi.fn();
    const id = manager.start(100, '0x1000', 1, 100, readFn, onChange);

    // First tick: sets initial value, no onChange because lastValue was ''
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).not.toHaveBeenCalled();

    // Second tick: value changed from AA to BB
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledWith('AA', 'BB');

    // Third tick: value unchanged (BB -> BB)
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1); // still just once

    manager.stop(id);
  });

  it('does not invoke onChange when read fails', async () => {
    const readFn = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: 'AA' })
      .mockResolvedValueOnce({ success: false, error: 'read error' });

    const onChange = vi.fn();
    const id = manager.start(100, '0x1000', 1, 100, readFn, onChange);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    expect(onChange).not.toHaveBeenCalled();

    manager.stop(id);
  });

  it('stop returns true for active monitor and false for unknown', () => {
    const readFn = vi.fn().mockResolvedValue({ success: true, data: 'AA' });
    const id = manager.start(100, '0x1000', 4, 1000, readFn);

    expect(manager.stop(id)).toBe(true);
    expect(manager.stop(id)).toBe(false);
    expect(manager.stop('nonexistent_id')).toBe(false);
  });

  it('stops polling after monitor is stopped', async () => {
    const readFn = vi.fn().mockResolvedValue({ success: true, data: 'AA' });
    const id = manager.start(100, '0x1000', 4, 200, readFn);

    await vi.advanceTimersByTimeAsync(200);
    expect(readFn).toHaveBeenCalledTimes(1);

    manager.stop(id);

    await vi.advanceTimersByTimeAsync(400);
    expect(readFn).toHaveBeenCalledTimes(1); // no more calls after stop
  });

  it('supports multiple concurrent monitors', async () => {
    const readFn1 = vi.fn().mockResolvedValue({ success: true, data: 'AA' });
    const readFn2 = vi.fn().mockResolvedValue({ success: true, data: 'BB' });

    const id1 = manager.start(100, '0x1000', 4, 100, readFn1);
    const id2 = manager.start(200, '0x2000', 8, 200, readFn2);

    await vi.advanceTimersByTimeAsync(200);

    expect(readFn1).toHaveBeenCalledTimes(2);
    expect(readFn2).toHaveBeenCalledTimes(1);

    manager.stop(id1);
    manager.stop(id2);
  });

  it('uses default size of 4 and interval of 1000', () => {
    const readFn = vi.fn().mockResolvedValue({ success: true, data: 'AA' });
    const id = manager.start(100, '0x1000', undefined, undefined, readFn);

    // Verify defaults by checking the read function is called with size=4 after 1000ms
    vi.advanceTimersByTime(999);
    expect(readFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    // Timer should have fired now
    expect(readFn).toHaveBeenCalledWith(100, '0x1000', 4);

    manager.stop(id);
  });
});
