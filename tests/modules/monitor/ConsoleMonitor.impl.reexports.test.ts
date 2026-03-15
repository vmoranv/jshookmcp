import { describe, expect, it } from 'vitest';

import { ConsoleMonitor as ImplConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl';
import { ConsoleMonitor as CoreConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl.core';
import { ConsoleMonitor as ClassConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl.core.class';

describe('ConsoleMonitor internal re-exports', () => {
  it('exposes the same ConsoleMonitor class through impl and core wrappers', () => {
    expect(ImplConsoleMonitor).toBe(ClassConsoleMonitor);
    expect(CoreConsoleMonitor).toBe(ClassConsoleMonitor);
  });
});
