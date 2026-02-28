import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryMonitorManager } from '../../../../src/modules/process/memory/monitor.js';

describe('memory/monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it('start returns monitor id and polls with provided interval', async () => {
    const manager = new MemoryMonitorManager();
    const readMemory = vi.fn().mockResolvedValue({ success: true, data: 'AA' });
    const id = manager.start(1, '0x10', 4, 1000, readMemory);

    expect(id).toMatch(/^monitor_/);
    await vi.advanceTimersByTimeAsync(3000);
    expect(readMemory).toHaveBeenCalledTimes(3);

    manager.stop(id);
  });

  it('onChange fires only after value changes from a previous value', async () => {
    const manager = new MemoryMonitorManager();
    const readMemory = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: 'AA' })
      .mockResolvedValueOnce({ success: true, data: 'BB' });
    const onChange = vi.fn();
    const id = manager.start(2, '0x20', 4, 500, readMemory, onChange);

    await vi.advanceTimersByTimeAsync(1000);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('AA', 'BB');
    manager.stop(id);
  });

  it('does not fire onChange when value remains the same', async () => {
    const manager = new MemoryMonitorManager();
    const readMemory = vi.fn().mockResolvedValue({ success: true, data: 'AA' });
    const onChange = vi.fn();
    const id = manager.start(3, '0x30', 4, 400, readMemory, onChange);

    await vi.advanceTimersByTimeAsync(1200);

    expect(onChange).not.toHaveBeenCalled();
    manager.stop(id);
  });

  it('stop returns true for active monitor and prevents further polling', async () => {
    const manager = new MemoryMonitorManager();
    const readMemory = vi.fn().mockResolvedValue({ success: true, data: 'AA' });
    const id = manager.start(4, '0x40', 4, 300, readMemory);

    await vi.advanceTimersByTimeAsync(600);
    const callsBeforeStop = readMemory.mock.calls.length;
    const stopped = manager.stop(id);
    await vi.advanceTimersByTimeAsync(900);

    expect(stopped).toBe(true);
    expect(readMemory.mock.calls.length).toBe(callsBeforeStop);
  });

  it('stop returns false for unknown monitor id', () => {
    const manager = new MemoryMonitorManager();
    expect(manager.stop('monitor_not_found')).toBe(false);
  });
});

