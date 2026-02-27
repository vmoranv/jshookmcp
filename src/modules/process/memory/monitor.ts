/**
 * Memory Monitor - polling-based memory change detection
 */

import { type MemoryReadResult, type MemoryMonitorEntry } from './types.js';

export class MemoryMonitorManager {
  private activeMonitors: Map<string, MemoryMonitorEntry> = new Map();

  start(
    pid: number,
    address: string,
    size: number = 4,
    intervalMs: number = 1000,
    readMemoryFn: (pid: number, address: string, size: number) => Promise<MemoryReadResult>,
    onChange?: (oldValue: string, newValue: string) => void
  ): string {
    const monitorId = `monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const timer = setInterval(async () => {
      const monitor = this.activeMonitors.get(monitorId);
      if (!monitor) return;

      const result = await readMemoryFn(pid, address, size);
      if (result.success && result.data) {
        if (monitor.lastValue !== result.data) {
          if (onChange && monitor.lastValue !== '') {
            onChange(monitor.lastValue, result.data);
          }
          monitor.lastValue = result.data;
        }
      }
    }, intervalMs);

    this.activeMonitors.set(monitorId, {
      pid,
      address,
      interval: intervalMs,
      lastValue: '',
      timer,
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
