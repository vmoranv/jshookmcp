/**
 * Memory Monitor - polling-based memory change detection
 */

import { type MemoryReadResult, type MemoryMonitorEntry } from '@modules/process/memory/types';

export class MemoryMonitorManager {
  private activeMonitors: Map<string, MemoryMonitorEntry & { inFlight?: boolean }> = new Map();

  /** Canonical monitor defaults — facades (MemoryManager/memoryUtils) pass through. */
  start(
    pid: number,
    address: string,
    size: number = 4, // 32-bit read
    intervalMs: number = 1000, // 1s poll

    readMemoryFn: (pid: number, address: string, size: number) => Promise<MemoryReadResult>,
    onChange?: (oldValue: string, newValue: string) => void,
  ): string {
    const monitorId = `monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const timer = setInterval(async () => {
      const monitor = this.activeMonitors.get(monitorId);
      if (!monitor) return;
      // Skip ticks while a previous read is still pending — async read can take
      // longer than intervalMs and concurrent updates to lastValue race.
      if (monitor.inFlight) return;
      monitor.inFlight = true;
      try {
        const result = await readMemoryFn(pid, address, size);
        if (result.success && result.data) {
          if (monitor.lastValue !== result.data) {
            if (onChange && monitor.lastValue !== '') {
              onChange(monitor.lastValue, result.data);
            }
            monitor.lastValue = result.data;
          }
        }
      } catch {
        // A failed read must not become an unhandled rejection (which would
        // terminate the host process); skip this tick and keep polling.
      } finally {
        monitor.inFlight = false;
      }
    }, intervalMs);
    // Don't keep Node.js alive just for the monitor.
    if (typeof timer.unref === 'function') timer.unref();

    this.activeMonitors.set(monitorId, {
      pid,
      address,
      interval: intervalMs,
      lastValue: '',
      timer,
      inFlight: false,
    });

    return monitorId;
  }

  stop(monitorId: string): boolean {
    const monitor = this.activeMonitors.get(monitorId);
    if (monitor) {
      clearInterval(monitor.timer);
      this.activeMonitors.delete(monitorId);
      return true;
    }
    return false;
  }
}
