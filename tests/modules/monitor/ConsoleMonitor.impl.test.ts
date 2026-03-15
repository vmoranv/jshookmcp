import { describe, expect, it } from 'vitest';

import { ConsoleMonitor as ImplConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl';
import { ConsoleMonitor as CoreConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl.core';

describe('ConsoleMonitor.impl.ts', () => {
  it('re-exports the internal ConsoleMonitor class', () => {
    expect(ImplConsoleMonitor).toBe(CoreConsoleMonitor);
  });
});
